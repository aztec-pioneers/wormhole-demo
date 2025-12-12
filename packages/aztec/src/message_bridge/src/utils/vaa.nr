use keccak256::keccak256;
use poseidon::poseidon2::Poseidon2;
use crate::utils::{
    WORMHOLE_MESSAGE_ID,
    VAA_MAX_LENGTH,
    VAA_ENVELOPE_START,
    VAA_PAYLOAD_START,
    MESSAGE_NULLIFIER_LENGTH,
    MESSAGE_NULLIFIER_PACKED_LENGTH,
    DecodedVAAEnvelope,
    DecodedVAAPayload,
    DecodedVAA,
    pack_bytes,
    u16_to_u8
};

pub struct DecodedVAA {
    pub envelope: DecodedVAAEnvelope,
    pub payload: DecodedVAAPayload,
}

/// Parse a raw VAA and extract envelope, payload, and compute nullifier
///
/// VAA structure (with 1 signature):
///   Bytes 0-5:     Header (version, guardian set, num sigs) - skipped
///   Bytes 6-71:    Signature - skipped
///   Bytes 72-122:  Envelope (timestamp, nonce, emitter chain, emitter addr, sequence, consistency)
///   Bytes 123+:    Payload
pub fn decode_vaa(vaa: [u8; VAA_MAX_LENGTH]) -> (
    DecodedVAAEnvelope,
    DecodedVAAPayload,
    Field,
) {
    let envelope = decode_vaa_envelope(vaa);
    let payload = decode_vaa_payload(vaa);
    let nullifier = compute_vaa_nullifier(vaa);
    (envelope, payload, nullifier)
}

/// Parse the VAA envelope (starts at byte 72 for 1 signature)
///
/// Envelope structure (51 bytes):
///   Bytes 0-3:   timestamp (u32, big-endian)
///   Bytes 4-7:   nonce (u32, big-endian)
///   Bytes 8-9:   emitter_chain_id (u16, big-endian)
///   Bytes 10-41: emitter_address (32 bytes)
///   Bytes 42-49: sequence (u64, big-endian)
///   Byte 50:     consistency_level (u8)
pub fn decode_vaa_envelope(vaa: [u8; VAA_MAX_LENGTH]) -> DecodedVAAEnvelope {
    let offset = VAA_ENVELOPE_START;

    // timestamp (4 bytes, big-endian)
    let timestamp = (
        (vaa[offset] as Field) * 16777216      // 2^24
        + (vaa[offset + 1] as Field) * 65536   // 2^16
        + (vaa[offset + 2] as Field) * 256     // 2^8
        + (vaa[offset + 3] as Field)
    ) as u32;

    // nonce (4 bytes, big-endian)
    let nonce = (
        (vaa[offset + 4] as Field) * 16777216
        + (vaa[offset + 5] as Field) * 65536
        + (vaa[offset + 6] as Field) * 256
        + (vaa[offset + 7] as Field)
    ) as u32;

    // emitter_chain_id (2 bytes, big-endian)
    let emitter_chain_id = (
        (vaa[offset + 8] as Field) * 256
        + (vaa[offset + 9] as Field)
    ) as u16;

    // emitter_address (32 bytes)
    let mut emitter_address = [0; 32];
    for i in 0..32 {
        emitter_address[i] = vaa[offset + 10 + i];
    }

    // sequence (8 bytes, big-endian)
    let sequence = (
        (vaa[offset + 42] as Field) * 72057594037927936   // 2^56
        + (vaa[offset + 43] as Field) * 281474976710656   // 2^48
        + (vaa[offset + 44] as Field) * 1099511627776     // 2^40
        + (vaa[offset + 45] as Field) * 4294967296        // 2^32
        + (vaa[offset + 46] as Field) * 16777216          // 2^24
        + (vaa[offset + 47] as Field) * 65536             // 2^16
        + (vaa[offset + 48] as Field) * 256               // 2^8
        + (vaa[offset + 49] as Field)
    ) as u64;

    // consistency_level (1 byte)
    let consistency_level = vaa[offset + 50];

    DecodedVAAEnvelope {
        timestamp,
        nonce,
        emitter_chain_id,
        emitter_address,
        sequence,
        consistency_level,
    }
}

/// Parse the VAA payload (starts at byte 123 for 1 signature)
///
/// Payload structure (38 bytes):
///   Byte 0:      message_id (u8)
///   Bytes 1-2:   source_chain_id (u16, big-endian)
///   Bytes 3-4:   destination_chain_id (u16, big-endian)
///   Bytes 5-36:  sender (32 bytes)
///   Byte 37:     value (u8)
pub fn decode_vaa_payload(vaa: [u8; VAA_MAX_LENGTH]) -> DecodedVAAPayload {
    let offset = VAA_PAYLOAD_START;

    // message_id (1 byte)
    let message_id = vaa[offset];
    assert(message_id == WORMHOLE_MESSAGE_ID, "Invalid payload ID");

    // source_chain_id (2 bytes, big-endian)
    let source_chain_id = (
        (vaa[offset + 1] as Field) * 256
        + (vaa[offset + 2] as Field)
    ) as u16;

    // destination_chain_id (2 bytes, big-endian)
    let destination_chain_id = (
        (vaa[offset + 3] as Field) * 256
        + (vaa[offset + 4] as Field)
    ) as u16;

    // sender (32 bytes)
    let mut sender = [0; 32];
    for i in 0..32 {
        sender[i] = vaa[offset + 5 + i];
    }

    // value (1 byte)
    let value = vaa[offset + 37];

    DecodedVAAPayload {
        message_id,
        source_chain_id,
        destination_chain_id,
        sender,
        value,
    }
}

/// Compute nullifier from VAA bytes (for replay protection)
fn compute_vaa_nullifier(vaa: [u8; VAA_MAX_LENGTH]) -> Field {
    // Pack the relevant bytes (envelope + payload) for hashing
    let mut nullifier_bytes = [0; MESSAGE_NULLIFIER_LENGTH];
    for i in 0..MESSAGE_NULLIFIER_LENGTH {
        nullifier_bytes[i] = vaa[VAA_ENVELOPE_START + i];
    }

    let packed = pack_bytes(nullifier_bytes);
    Poseidon2::hash(packed, MESSAGE_NULLIFIER_PACKED_LENGTH)
}

/// Encode a message payload for sending via Wormhole (Aztec -> EVM)
///
/// Payload structure (38 bytes):
///   Byte 0:      message_id (u8)
///   Bytes 1-2:   source_chain_id (u16, big-endian)
///   Bytes 3-4:   destination_chain_id (u16, big-endian)
///   Bytes 5-36:  sender (32 bytes)
///   Byte 37:     value (u8)
///
/// Returns 8 chunks of 31 bytes for Aztec Field compatibility
pub fn encode_message_payload(
    sender: [u8; 32],
    value: u8,
    source_chain_id: u16,
    destination_chain_id: u16,
) -> [[u8; 31]; 8] {
    let mut wormhole_payload: [[u8; 31]; 8] = [[0; 31]; 8];

    let source_chain_bytes = u16_to_u8(source_chain_id);
    let destination_chain_bytes = u16_to_u8(destination_chain_id);

    // Chunk 0: message_id + chains + sender[0-25]
    wormhole_payload[0][0] = WORMHOLE_MESSAGE_ID;
    wormhole_payload[0][1] = source_chain_bytes[0];
    wormhole_payload[0][2] = source_chain_bytes[1];
    wormhole_payload[0][3] = destination_chain_bytes[0];
    wormhole_payload[0][4] = destination_chain_bytes[1];
    for i in 0..26 {
        wormhole_payload[0][5 + i] = sender[i];
    }

    // Chunk 1: sender[26-31] + value + padding
    for i in 0..6 {
        wormhole_payload[1][i] = sender[26 + i];
    }
    wormhole_payload[1][6] = value;

    wormhole_payload
}

// Keccak hash of VAA body (for signature verification)
pub fn compute_vaa_hash(body_bytes: [u8; 1860], body_length: u32) -> [u8; 32] {
    let mut actual_body = [0; 1860];
    for i in 0..body_length {
        actual_body[i] = body_bytes[i];
    }

    // Double hash as per Wormhole spec
    let hash: [u8; 32] = keccak256(actual_body, body_length);
    let double_hash: [u8; 32] = keccak256(hash, 32);

    double_hash
}
