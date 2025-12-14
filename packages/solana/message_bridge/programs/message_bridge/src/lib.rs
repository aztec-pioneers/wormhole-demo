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

declare_id!("7sUZQGRVwV7Cps1zVaASJAJ1N3rgijtX8SbYNt1pej3q");

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
    ///
    /// # Arguments
    /// * `chain_id` - Wormhole chain ID of the foreign chain
    /// * `emitter_address` - Emitter address on the foreign chain (32 bytes)
    /// * `is_default_payload` - true for default 18-byte payload (Solana/EVM), false for Aztec 50-byte payload
    pub fn register_emitter(
        ctx: Context<RegisterEmitter>,
        chain_id: u16,
        emitter_address: [u8; 32],
        is_default_payload: bool,
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
        foreign_emitter.is_default_payload = is_default_payload;

        msg!("Registered emitter for chain {}", chain_id);
        msg!("Address: {:?}", emitter_address);
        msg!("Is default payload: {}", is_default_payload);

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

        // Get Wormhole fee from bridge data account and transfer to fee collector
        // BridgeData layout:
        //   guardian_set_index: u32 (offset 0, 4 bytes)
        //   last_lamports: u64 (offset 4, 8 bytes)
        //   config.guardian_set_expiration_time: u32 (offset 12, 4 bytes)
        //   config.fee: u64 (offset 16, 8 bytes)
        {
            let bridge_data = ctx.accounts.wormhole_bridge.try_borrow_data()?;
            let fee = if bridge_data.len() >= 24 {
                u64::from_le_bytes(bridge_data[16..24].try_into().unwrap_or([0u8; 8]))
            } else {
                0
            };
            drop(bridge_data); // Explicitly drop before transfer

            if fee > 0 {
                require!(
                    ctx.accounts.payer.lamports() >= fee,
                    MessageBridgeError::InsufficientFee
                );

                // Transfer fee to Wormhole fee collector
                anchor_lang::system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        anchor_lang::system_program::Transfer {
                            from: ctx.accounts.payer.to_account_info(),
                            to: ctx.accounts.wormhole_fee_collector.to_account_info(),
                        },
                    ),
                    fee,
                )?;
            }
        }

        // Encode the payload
        let payload = ValueMessage {
            destination_chain_id,
            value,
        }
        .encode();

        // Get nonce before mutable operations
        let nonce = config.nonce;
        let nonce_bytes = nonce.to_le_bytes();

        // Post message to Wormhole - need to sign with both emitter and message PDAs
        let emitter_seeds: &[&[u8]] = &[
            WormholeEmitter::SEED_PREFIX,
            &[wormhole_emitter.bump],
        ];

        let message_bump = ctx.bumps.wormhole_message;
        let message_seeds: &[&[u8]] = &[
            b"message",
            &nonce_bytes,
            &[message_bump],
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
                &[emitter_seeds, message_seeds],
            ),
            nonce,
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
        // PostedVAA layout (Borsh serialized):
        // - 3 bytes: magic "vaa"
        // Then MessageData (Borsh format, little-endian):
        // - 1 byte: vaa_version (offset 3)
        // - 1 byte: consistency_level (offset 4)
        // - 4 bytes: vaa_time (offset 5)
        // - 32 bytes: vaa_signature_account (offset 9)
        // - 4 bytes: submission_time (offset 41)
        // - 4 bytes: nonce (offset 45)
        // - 8 bytes: sequence (offset 49)
        // - 2 bytes: emitter_chain (offset 57)
        // - 32 bytes: emitter_address (offset 59)
        // - 4 bytes: payload length (offset 91)
        // - payload data (offset 95)
        let vaa_data = posted_vaa.try_borrow_data()?;

        // Minimum size: 3 + 88 + 4 = 95 bytes (before payload data)
        require!(vaa_data.len() >= 95, MessageBridgeError::InvalidPayload);

        // Parse emitter chain (offset 57, 2 bytes, little-endian)
        let parsed_emitter_chain = u16::from_le_bytes([vaa_data[57], vaa_data[58]]);

        // Parse emitter address (offset 59, 32 bytes)
        let mut parsed_emitter_address = [0u8; 32];
        parsed_emitter_address.copy_from_slice(&vaa_data[59..91]);

        // Parse sequence (offset 49, 8 bytes, little-endian)
        let parsed_sequence = u64::from_le_bytes(vaa_data[49..57].try_into().unwrap());

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

        // Get payload (Vec<u8> with 4-byte length prefix at offset 91)
        // Read payload length (4 bytes LE at offset 91)
        let payload_len = u32::from_le_bytes(vaa_data[91..95].try_into().unwrap()) as usize;
        require!(
            vaa_data.len() >= 95 + payload_len,
            MessageBridgeError::InvalidPayload
        );
        let payload = &vaa_data[95..95 + payload_len];

        // Decode the message based on registered emitter type
        // is_default_payload: true = 18-byte (Solana/EVM), false = 50-byte (Aztec with txId)
        let value = if foreign_emitter.is_default_payload {
            // Default payload: [chainId(2) | value(16)]
            require!(
                payload.len() >= ValueMessage::PAYLOAD_SIZE,
                MessageBridgeError::InvalidPayload
            );
            let msg = ValueMessage::decode(payload)?;

            // Validate destination chain
            require!(
                msg.destination_chain_id == config.chain_id,
                MessageBridgeError::InvalidDestinationChainId
            );

            msg.value
        } else {
            // Aztec payload: [txId(32) | chainId(2) | value(16)]
            require!(
                payload.len() >= InboundMessage::PAYLOAD_SIZE,
                MessageBridgeError::InvalidPayload
            );
            let inbound = InboundMessage::decode(payload)?;

            // Validate destination chain
            require!(
                inbound.destination_chain_id == config.chain_id,
                MessageBridgeError::InvalidDestinationChainId
            );

            inbound.value
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

}
