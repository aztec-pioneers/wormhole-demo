use anchor_lang::prelude::*;

/// Program configuration account
#[account]
#[derive(Default)]
pub struct Config {
    /// Program owner (can register emitters)
    pub owner: Pubkey,
    /// Wormhole program ID
    pub wormhole_program: Pubkey,
    /// Wormhole bridge (core) account
    pub wormhole_bridge: Pubkey,
    /// Wormhole fee collector account
    pub wormhole_fee_collector: Pubkey,
    /// Wormhole emitter account (PDA)
    pub wormhole_emitter: Pubkey,
    /// Wormhole sequence account
    pub wormhole_sequence: Pubkey,
    /// Wormhole chain ID for Solana (1)
    pub chain_id: u16,
    /// Nonce for outbound messages
    pub nonce: u32,
}

impl Config {
    pub const SEED_PREFIX: &'static [u8] = b"config";

    /// Config account size
    /// 8 (discriminator) + 32*6 (pubkeys) + 2 (chain_id) + 4 (nonce)
    pub const SPACE: usize = 8 + 32 * 6 + 2 + 4;
}

/// Registered foreign emitter (one per chain)
#[account]
#[derive(Default)]
pub struct ForeignEmitter {
    /// Wormhole chain ID of the foreign chain
    pub chain_id: u16,
    /// Emitter address on the foreign chain (32 bytes)
    pub address: [u8; 32],
    /// Payload format: true = default 18-byte (Solana/EVM), false = Aztec 50-byte (with txId)
    pub is_default_payload: bool,
}

impl ForeignEmitter {
    pub const SEED_PREFIX: &'static [u8] = b"foreign_emitter";

    /// ForeignEmitter account size
    /// 8 (discriminator) + 2 (chain_id) + 32 (address) + 1 (is_default_payload)
    pub const SPACE: usize = 8 + 2 + 32 + 1;

    /// Verify that an emitter address matches this registered emitter
    pub fn verify(&self, emitter_address: &[u8; 32]) -> bool {
        self.address == *emitter_address
    }
}

/// Received message (for replay protection)
#[account]
#[derive(Default)]
pub struct ReceivedMessage {
    /// Wormhole message sequence number
    pub sequence: u64,
    /// Source chain ID
    pub emitter_chain: u16,
    /// The value that was received
    pub value: u128,
    /// Batch ID (for grouping)
    pub batch_id: u32,
}

impl ReceivedMessage {
    pub const SEED_PREFIX: &'static [u8] = b"received";

    /// ReceivedMessage account size
    /// 8 (discriminator) + 8 (sequence) + 2 (emitter_chain) + 16 (value) + 4 (batch_id)
    pub const SPACE: usize = 8 + 8 + 2 + 16 + 4;
}

/// Wormhole emitter account (PDA that signs messages)
#[account]
#[derive(Default)]
pub struct WormholeEmitter {
    /// Bump seed for PDA derivation
    pub bump: u8,
}

impl WormholeEmitter {
    pub const SEED_PREFIX: &'static [u8] = b"emitter";

    pub const SPACE: usize = 8 + 1;
}

/// Current value storage (like EVM contract's currentValue)
#[account]
#[derive(Default)]
pub struct CurrentValue {
    /// The current value received via cross-chain message
    pub value: u128,
}

impl CurrentValue {
    pub const SEED_PREFIX: &'static [u8] = b"current_value";

    pub const SPACE: usize = 8 + 16;
}

