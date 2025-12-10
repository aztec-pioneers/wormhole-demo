use aztec::protocol_types::{
    traits::{Serialize, Deserialize, Packable},
    address::AztecAddress,
};

/// Bridge configuration stored as immutable state
#[derive(Serialize, Deserialize, Packable, Eq)]
pub struct Config {
    pub wormhole_address: AztecAddress,   // Wormhole contract address
    pub chain_id: u16,                    // This chain's Wormhole chain ID (56 for Aztec)
}

impl Config {
    pub fn new(wormhole_address: AztecAddress, chain_id: u16) -> Self {
        Self { wormhole_address, chain_id }
    }
}

/// Registered emitter for a remote chain
/// This stores which bridge contracts on other chains are trusted
#[derive(Serialize, Deserialize, Packable, Eq)]
pub struct RegisteredEmitter {
    pub emitter_address: [u8; 32],  // Bridge contract address on remote chain (as bytes32)
    pub enabled: bool,               // Whether this emitter is trusted
}

impl RegisteredEmitter {
    pub fn new(emitter_address: [u8; 32], enabled: bool) -> Self {
        Self { emitter_address, enabled }
    }

    pub fn default() -> Self {
        Self { emitter_address: [0; 32], enabled: false }
    }
}
