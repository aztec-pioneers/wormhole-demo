use aztec::protocol_types::{
    traits::{Serialize, Deserialize, Packable},
    address::AztecAddress,
};

/// Bridge configuration stored as immutable state
#[derive(Serialize, Deserialize, Packable, Eq)]
pub struct Config {
    pub wormhole_address: AztecAddress,   // Wormhole contract address
    pub chain_id: u16,                    // This chain's Wormhole chain ID (56 for Aztec)
    pub message_fee: u128,                // Messsage fee (should be moved to delayed mutable)
    pub consistency: u8                   // Finality / consistency level for Wormhole messages
}

impl Config {
    pub fn new(
        wormhole_address: AztecAddress,
        chain_id: u16,
        message_fee: u128,
        consistency: u8
    ) -> Self {
        Self { wormhole_address, chain_id, message_fee, consistency }
    }
}
