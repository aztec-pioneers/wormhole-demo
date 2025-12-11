pub mod vaa;

use aztec::protocol_types::{
    address::AztecAddress,
    traits::ToField,
};
use nodash::ArrayExtensions;

/// Wormhole Payload ID for simple value messages
pub global WORMHOLE_MESSAGE_ID: u8 = 99;
pub global VAA_BODY_START: u32 = 6 + 66; // hardcoded as 1 signature
pub global VAA_MAX_LENGTH: u32 = 2000; // max VAA length in Wormhole spec
pub global VAA_BODY_MAX_LENGTH: u32 = 1860; // max body length in Wormhole VAA spec
// we know the actual payload length we will always observe
pub global MESSAGE_PAYLOAD_LENGTH: u32 = 39; 
pub global MESSAGE_NULLIFIER_LENGTH: u32 = VAA_BODY_START + MESSAGE_PAYLOAD_LENGTH;
pub global MESSAGE_NULLIFIER_PACKED_LENGTH: u32 = 4; // ceil(MESSAGE_NULLIFIER_LENGTH / 31)

pub struct DecodedVAAPayload {
    pub value: u8,
    pub source_chain_id: u16,
    pub destination_chain_id: u16,
    pub sender: Field,
    pub nullifier: Field
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