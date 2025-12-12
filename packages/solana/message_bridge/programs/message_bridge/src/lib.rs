use anchor_lang::prelude::*;
use wormhole_anchor_sdk::wormhole;

pub mod context;
pub mod error;
pub mod message;
pub mod state;

pub use context::*;
pub use error::*;
pub use message::*;
pub use state::*;

declare_id!("3h4x6rCxFuAnuhavC6Wczusv2YgTA3mn5FWEsjXxnLWk");

/// Wormhole chain ID for Solana
pub const SOLANA_CHAIN_ID: u16 = 1;

/// Consistency level (finalized)
pub const CONSISTENCY_LEVEL: u8 = 1;

#[program]
pub mod message_bridge {
    use super::*;

    /// Initialize the message bridge program
    ///
    /// This sets up the config account with Wormhole addresses and creates
    /// the emitter PDA that will sign outbound messages.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        // Store emitter bump first (before other borrows)
        ctx.accounts.wormhole_emitter.bump = ctx.bumps.wormhole_emitter;

        let config = &mut ctx.accounts.config;

        // Store owner
        config.owner = ctx.accounts.owner.key();

        // Store Wormhole addresses
        config.wormhole_program = ctx.accounts.wormhole_program.key();
        config.wormhole_bridge = ctx.accounts.wormhole_bridge.key();
        config.wormhole_fee_collector = ctx.accounts.wormhole_fee_collector.key();
        config.wormhole_emitter = ctx.accounts.wormhole_emitter.key();
        config.wormhole_sequence = ctx.accounts.wormhole_sequence.key();

        // Set chain ID and initial nonce
        config.chain_id = SOLANA_CHAIN_ID;
        config.nonce = 0;

        // Initialize current value to 0
        ctx.accounts.current_value.value = 0;

        msg!("MessageBridge initialized");
        msg!("Owner: {}", config.owner);
        msg!("Emitter: {}", config.wormhole_emitter);

        Ok(())
    }

    /// Register a foreign emitter from another chain
    ///
    /// Only the owner can register emitters. Each chain can have one emitter.
    pub fn register_emitter(
        ctx: Context<RegisterEmitter>,
        chain_id: u16,
        emitter_address: [u8; 32],
    ) -> Result<()> {
        // Cannot register Solana as a foreign emitter
        require!(
            chain_id != SOLANA_CHAIN_ID,
            MessageBridgeError::CannotRegisterSolanaEmitter
        );

        // Emitter address cannot be zero
        require!(
            emitter_address != [0u8; 32],
            MessageBridgeError::ZeroEmitterAddress
        );

        let foreign_emitter = &mut ctx.accounts.foreign_emitter;
        foreign_emitter.chain_id = chain_id;
        foreign_emitter.address = emitter_address;

        msg!("Registered emitter for chain {}", chain_id);
        msg!("Address: {:?}", emitter_address);

        Ok(())
    }

    /// Send a value to another chain via Wormhole
    ///
    /// This posts a message to Wormhole that can be relayed to the destination chain.
    pub fn send_value(
        ctx: Context<SendValue>,
        destination_chain_id: u16,
        value: u128,
    ) -> Result<()> {
        // Cannot send to Solana
        require!(
            destination_chain_id != SOLANA_CHAIN_ID,
            MessageBridgeError::InvalidDestinationChainId
        );

        let config = &mut ctx.accounts.config;
        let wormhole_emitter = &ctx.accounts.wormhole_emitter;

        // Get Wormhole fee from bridge data account
        // BridgeData layout has fee at offset 12 (4 bytes each for: guardian_set_index, guardian_set_expiry, fee)
        // Actually fee is a u64 at a specific offset - for simplicity we'll parse it
        let bridge_data = ctx.accounts.wormhole_bridge.try_borrow_data()?;
        // Fee is stored as u64 in lamports (offset varies by version, typically after guardian set info)
        // For now, we'll just ensure payer has some lamports and let Wormhole handle fee validation
        let fee = if bridge_data.len() >= 20 {
            // Try to read fee from expected location (this may need adjustment based on actual layout)
            u64::from_le_bytes(bridge_data[12..20].try_into().unwrap_or([0u8; 8]))
        } else {
            0
        };

        // Check payer has enough lamports for fee
        if fee > 0 {
            require!(
                ctx.accounts.payer.lamports() >= fee,
                MessageBridgeError::InsufficientFee
            );
        }

        // Encode the payload
        let payload = ValueMessage {
            destination_chain_id,
            value,
        }
        .encode();

        // Post message to Wormhole
        let emitter_seeds: &[&[u8]] = &[
            WormholeEmitter::SEED_PREFIX,
            &[wormhole_emitter.bump],
        ];

        wormhole::post_message(
            CpiContext::new_with_signer(
                ctx.accounts.wormhole_program.to_account_info(),
                wormhole::PostMessage {
                    config: ctx.accounts.wormhole_bridge.to_account_info(),
                    message: ctx.accounts.wormhole_message.to_account_info(),
                    emitter: ctx.accounts.wormhole_emitter.to_account_info(),
                    sequence: ctx.accounts.wormhole_sequence.to_account_info(),
                    payer: ctx.accounts.payer.to_account_info(),
                    fee_collector: ctx.accounts.wormhole_fee_collector.to_account_info(),
                    clock: ctx.accounts.clock.to_account_info(),
                    rent: ctx.accounts.rent.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
                &[emitter_seeds],
            ),
            config.nonce,
            payload,
            wormhole::Finality::Confirmed,
        )?;

        // Increment nonce for next message
        config.nonce += 1;

        msg!("Sent value {} to chain {}", value, destination_chain_id);

        Ok(())
    }

    /// Receive a value from another chain via Wormhole
    ///
    /// The VAA must be posted and verified before calling this instruction.
    /// The received message account provides replay protection.
    ///
    /// # Arguments
    /// * `vaa_hash` - Hash of the VAA (used for verification)
    /// * `emitter_chain` - Source chain ID from the VAA
    /// * `sequence` - Sequence number from the VAA
    pub fn receive_value(
        ctx: Context<ReceiveValue>,
        _vaa_hash: [u8; 32],
        emitter_chain: u16,
        sequence: u64,
    ) -> Result<()> {
        let posted_vaa = &ctx.accounts.posted_vaa;
        let current_value = &mut ctx.accounts.current_value;
        let received_message = &mut ctx.accounts.received_message;
        let config = &ctx.accounts.config;
        let foreign_emitter = &ctx.accounts.foreign_emitter;

        // Parse the posted VAA account data
        // PostedVaaV1 layout:
        // - 3 bytes: discriminator "vaa"
        // - 1 byte: version
        // - 4 bytes: guardian_set_index
        // - 4 bytes: timestamp
        // - 4 bytes: nonce
        // - 2 bytes: emitter_chain
        // - 32 bytes: emitter_address
        // - 8 bytes: sequence
        // - 1 byte: consistency_level
        // - remaining: payload
        let vaa_data = posted_vaa.try_borrow_data()?;

        // Minimum size: 3 + 1 + 4 + 4 + 4 + 2 + 32 + 8 + 1 = 59 bytes
        require!(vaa_data.len() >= 59, MessageBridgeError::InvalidPayload);

        // Parse emitter chain (offset 16, 2 bytes)
        let parsed_emitter_chain = u16::from_be_bytes([vaa_data[16], vaa_data[17]]);

        // Parse emitter address (offset 18, 32 bytes)
        let mut parsed_emitter_address = [0u8; 32];
        parsed_emitter_address.copy_from_slice(&vaa_data[18..50]);

        // Parse sequence (offset 50, 8 bytes)
        let parsed_sequence = u64::from_be_bytes(vaa_data[50..58].try_into().unwrap());

        // Verify the provided parameters match the VAA
        require!(
            parsed_emitter_chain == emitter_chain,
            MessageBridgeError::InvalidPayload
        );
        require!(
            parsed_sequence == sequence,
            MessageBridgeError::InvalidPayload
        );

        // Verify emitter is registered
        require!(
            foreign_emitter.verify(&parsed_emitter_address),
            MessageBridgeError::InvalidForeignEmitter
        );

        // Get payload (after consistency_level at offset 58)
        let payload = &vaa_data[59..];

        // Decode the message (with txId prefix from Aztec Guardian)
        let value = if payload.len() >= InboundMessage::PAYLOAD_SIZE {
            // Full message with txId (from Aztec)
            let inbound = InboundMessage::decode(payload)?;

            // Validate destination chain
            require!(
                inbound.destination_chain_id == config.chain_id,
                MessageBridgeError::InvalidDestinationChainId
            );

            inbound.value
        } else if payload.len() >= ValueMessage::PAYLOAD_SIZE {
            // Simple message without txId (from EVM)
            let msg = ValueMessage::decode(payload)?;

            // Validate destination chain
            require!(
                msg.destination_chain_id == config.chain_id,
                MessageBridgeError::InvalidDestinationChainId
            );

            msg.value
        } else {
            return Err(MessageBridgeError::InvalidPayload.into());
        };

        // Update current value
        current_value.value = value;

        // Store received message info (for replay protection)
        received_message.sequence = sequence;
        received_message.emitter_chain = emitter_chain;
        received_message.value = value;
        received_message.batch_id = 0; // Not available from raw parsing

        msg!("Received value {} from chain {}", value, emitter_chain);

        Ok(())
    }

    // =========================================================================
    // TESTING INSTRUCTIONS (Simple counter for basic access testing)
    // =========================================================================

    /// Initialize the counter (for testing basic contract access)
    pub fn initialize_counter(ctx: Context<InitializeCounter>) -> Result<()> {
        ctx.accounts.counter.count = 0;
        msg!("Counter initialized to 0");
        Ok(())
    }

    /// Increment the counter (for testing basic contract access)
    pub fn increment_counter(ctx: Context<IncrementCounter>) -> Result<()> {
        ctx.accounts.counter.count += 1;
        msg!("Counter incremented to {}", ctx.accounts.counter.count);
        Ok(())
    }

    /// Get the current counter value (for testing - view function via simulate)
    pub fn get_counter(ctx: Context<IncrementCounter>) -> Result<u64> {
        msg!("Counter value: {}", ctx.accounts.counter.count);
        Ok(ctx.accounts.counter.count)
    }
}
