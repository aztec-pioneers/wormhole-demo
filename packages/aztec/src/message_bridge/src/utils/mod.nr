pub mod vaa;

use aztec::protocol_types::{
    address::AztecAddress,
    traits::ToField,
};
use nodash::ArrayExtensions;

/// Wormhole Payload ID for simple value messages
pub global WORMHOLE_MESSAGE_ID: u8 = 99;

// VAA structure offsets (hardcoded for 1 signature)
pub global VAA_HEADER_SIZE: u32 = 6;        // version(1) + guardian_set(4) + num_sigs(1)
pub global VAA_SIGNATURE_SIZE: u32 = 66;    // guardian_index(1) + signature(64) + recovery(1)
pub global VAA_ENVELOPE_START: u32 = VAA_HEADER_SIZE + VAA_SIGNATURE_SIZE; // = 72
pub global VAA_ENVELOPE_SIZE: u32 = 51;     // timestamp(4) + nonce(4) + emitter_chain(2) + emitter_addr(32) + sequence(8) + consistency(1)
pub global VAA_PAYLOAD_START: u32 = VAA_ENVELOPE_START + VAA_ENVELOPE_SIZE; // = 123

pub global VAA_MAX_LENGTH: u32 = 2000;      // max VAA length in Wormhole spec
pub global VAA_BODY_MAX_LENGTH: u32 = 1860; // max body length in Wormhole VAA spec

// Message payload structure (38 bytes)
pub global MESSAGE_PAYLOAD_LENGTH: u32 = 38;
pub global MESSAGE_NULLIFIER_LENGTH: u32 = VAA_ENVELOPE_SIZE + MESSAGE_PAYLOAD_LENGTH; // 51 + 38 = 89
pub global MESSAGE_NULLIFIER_PACKED_LENGTH: u32 = 3; // ceil(89 / 31) = 3

/// Decoded VAA envelope (excludes header and signatures)
pub struct DecodedVAAEnvelope {
    pub timestamp: u32,
    pub nonce: u32,
    pub emitter_chain_id: u16,
    pub emitter_address: [u8; 32],
    pub sequence: u64,
    pub consistency_level: u8,
}

impl DecodedVAAEnvelope {
    // Converts the emitter address to a Field
    // drops the first byte of the emitter address to fit into 254 bit field
    pub fn emitter_as_field(self) -> Field {
        let mut addr_bytes = [0; 31];
        for i in 0..31 {
            addr_bytes[i] = self.emitter_address[i + 1];
        }
        Field::from_be_bytes(addr_bytes)
    }
}

/// Decoded message payload
pub struct DecodedVAAPayload {
    pub message_id: u8,
    pub source_chain_id: u16,
    pub destination_chain_id: u16,
    pub sender: [u8; 32],
    pub value: u8,
}


pub fn address_to_bytes32(addr: AztecAddress) -> [u8; 32] {
    addr.to_field().to_be_bytes()
}

pub fn u16_to_u8(value: u16) -> [u8; 2] {
    // Safety: constrained below, use unconstrained for bitwise ops
    let decomposed = unsafe { _u16_to_u8(value) };
    let asserted = decomposed[0] as u16 * 256 + decomposed[1] as u16;
    assert(asserted == value, "u16 to u8 conversion failed");
    decomposed
}

unconstrained pub fn _u16_to_u8(value: u16) -> [u8; 2]{
    let high = (value >> 8) as u8;
    let low = (value & 0xFF) as u8;
    [high, low]
}

// https://github.com/olehmisar/nodash/blob/main/src/array.nr#L42C1-L50C2
// cannot import from nodash because of private dependency
pub fn pack_bytes<let N: u32>(bytes: [u8; N]) -> [Field; N / 31 + 1] {
    let bytes_padded = bytes.pad_end::<(N / 31 + 1) * 31>(0);
    let mut res = [0 as Field; N / 31 + 1];
    for i in 0..N / 31 + 1 {
        let chunk = bytes_padded.slice::<31>(i * 31);
        res[i] = Field::from_le_bytes(chunk);
    }
    res
}