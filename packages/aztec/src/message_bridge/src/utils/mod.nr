pub mod vaa;

// VAA structure offsets (hardcoded for 1 signature)
pub global VAA_HEADER_SIZE: u32 = 6;        // version(1) + guardian_set(4) + num_sigs(1)
pub global VAA_SIGNATURE_SIZE: u32 = 66;    // guardian_index(1) + signature(64) + recovery(1)
pub global VAA_ENVELOPE_START: u32 = VAA_HEADER_SIZE + VAA_SIGNATURE_SIZE; // = 72
pub global VAA_ENVELOPE_SIZE: u32 = 51;     // timestamp(4) + nonce(4) + emitter_chain(2) + emitter_addr(32) + sequence(8) + consistency(1)
pub global VAA_PAYLOAD_START: u32 = VAA_ENVELOPE_START + VAA_ENVELOPE_SIZE; // = 123

pub global VAA_MAX_LENGTH: u32 = 2000;      // max VAA length in Wormhole spec
pub global VAA_BODY_MAX_LENGTH: u32 = 1860; // max body length in Wormhole VAA spec

// Message payload structure (18 bytes): destinationChainId (2) + value (16)
pub global MESSAGE_PAYLOAD_LENGTH: u32 = 18;
pub global MESSAGE_NULLIFIER_LENGTH: u32 = VAA_ENVELOPE_SIZE + MESSAGE_PAYLOAD_LENGTH; // 51 + 18 = 69
pub global MESSAGE_NULLIFIER_PACKED_LENGTH: u32 = 3; // ceil(69 / 31) = 3

/// Decoded VAA envelope (excludes header and signatures)
pub struct DecodedVAAEnvelope {
    pub timestamp: u32,
    pub nonce: u32,
    pub emitter_chain_id: u16,
    pub emitter_address: [u8; 32],
    pub sequence: u64,
    pub consistency_level: u8,
}


/// Decoded message payload (18 bytes)
pub struct DecodedVAAPayload {
    pub destination_chain_id: u16,
    pub value: u128,
}

// probably should just use Field::to_le_bytes but meh
pub fn u16_to_u8(value: u16) -> [u8; 2] {
    // Safety: constrained below, use unconstrained for bitwise ops
    let decomposed = unsafe { _u16_to_u8(value) };
    let asserted = decomposed[0] as u16 * 256 + decomposed[1] as u16;
    assert(asserted == value, "u16 to u8 conversion failed");
    decomposed
}

unconstrained fn _u16_to_u8(value: u16) -> [u8; 2] {
    let high = (value >> 8) as u8;
    let low = (value & 0xFF) as u8;
    [high, low]
}