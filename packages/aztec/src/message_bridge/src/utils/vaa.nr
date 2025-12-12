use keccak256::keccak256;
use poseidon::poseidon2::Poseidon2;
use crate::utils::{
    VAA_MAX_LENGTH,
    VAA_ENVELOPE_START,
    VAA_PAYLOAD_START,
    MESSAGE_NULLIFIER_LENGTH,
    MESSAGE_NULLIFIER_PACKED_LENGTH,
    DecodedVAAEnvelope,
    DecodedVAAPayload,
    pack_bytes,
    u16_to_u8,
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
    let mut timestamp_bytes: [u8; 4] = [0; 4];
    for i in 0..4 {
        timestamp_bytes[i] = vaa[offset + i];
    }
    let timestamp = Field::from_be_bytes(timestamp_bytes) as u32;

    // nonce (4 bytes, big-endian)
    let mut nonce_bytes: [u8; 4] = [0; 4];
    for i in 0..4 {
        nonce_bytes[i] = vaa[offset + 4 + i];
    }
    let nonce = Field::from_be_bytes(nonce_bytes) as u32;

    // emitter_chain_id (2 bytes, big-endian)
    let mut chain_id_bytes: [u8; 2] = [0; 2];
    for i in 0..2 {
        chain_id_bytes[i] = vaa[offset + 8 + i];
    }
    let emitter_chain_id = Field::from_be_bytes(chain_id_bytes) as u16;

    // emitter_address (32 bytes)
    let mut emitter_address: [u8; 32] = [0; 32];
    for i in 0..32 {
        emitter_address[i] = vaa[offset + 10 + i];
    }

    // sequence (8 bytes, big-endian)
    let mut sequence_bytes: [u8; 8] = [0; 8];
    for i in 0..8 {
        sequence_bytes[i] = vaa[offset + 42 + i];
    }
    let sequence = Field::from_be_bytes(sequence_bytes) as u64;

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
/// Payload structure (18 bytes):
///   Bytes 0-1:   destination_chain_id (u16, big-endian)
///   Bytes 2-17:  value (u128, big-endian)
pub fn decode_vaa_payload(vaa: [u8; VAA_MAX_LENGTH]) -> DecodedVAAPayload {
    let offset = VAA_PAYLOAD_START;

    // destination_chain_id (2 bytes, big-endian)
    let destination_chain_id = (
        (vaa[offset] as Field) * 256
        + (vaa[offset + 1] as Field)
    ) as u16;

    // value (16 bytes, big-endian) - parse as u128 via Field multiplication
    let mut value_bytes: [u8; 16] = [0; 16];
    for i in 0..16 {
        value_bytes[i] = vaa[offset + 2 + i];
    }
    let value = Field::from_be_bytes(value_bytes) as u128;

    DecodedVAAPayload {
        destination_chain_id,
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
/// Payload structure (18 bytes):
///   Bytes 0-1:   destination_chain_id (u16, big-endian)
///   Bytes 2-17:  value (u128, big-endian)
///
/// Returns 8 chunks of 31 bytes for Aztec Field compatibility
pub fn encode_message_payload(
    value: u128,
    destination_chain_id: u16,
) -> [[u8; 31]; 8] {
    let mut wormhole_payload: [[u8; 31]; 8] = [[0; 31]; 8];

    let destination_chain_bytes = u16_to_u8(destination_chain_id);
    let value_bytes: [u8; 16] = Field::to_be_bytes(value as Field);

    // Chunk 0: destination_chain_id (2 bytes) + value (16 bytes) = 18 bytes total
    wormhole_payload[0][0] = destination_chain_bytes[0];
    wormhole_payload[0][1] = destination_chain_bytes[1];
    for i in 0..16 {
        wormhole_payload[0][2 + i] = value_bytes[i];
    }

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
