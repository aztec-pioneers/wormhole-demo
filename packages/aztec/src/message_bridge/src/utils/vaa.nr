use keccak256::keccak256;
use poseidon::poseidon2::Poseidon2;
use crate::utils::{
    WORMHOLE_MESSAGE_ID,
    VAA_MAX_LENGTH,
    VAA_BODY_START,
    MESSAGE_PAYLOAD_LENGTH,
    DecodedVAAPayload,
    MESSAGE_NULLIFIER_LENGTH,
    MESSAGE_NULLIFIER_PACKED_LENGTH,
    pack_bytes,
    u16_to_u8
};

/// Message payload encoding (39 bytes, big-endian):
///   Byte 0:      message_id (u8)
///   Bytes 1-2:   source_chain_id (u16)
///   Bytes 3-4:   destination_chain_id (u16)
///   Bytes 5-36:  sender (32 bytes)
///   Bytes 37-38: value (u16)
pub fn decode_message_payload(vaa: [u8; VAA_MAX_LENGTH]) -> DecodedVAAPayload {
    // 1. parse the actual bytes we care about
    // note: we could skip this and directly read from vaa with offsets for slight efficiency gain
    let mut message_bytes = [0; MESSAGE_PAYLOAD_LENGTH];
    for i in 0..MESSAGE_PAYLOAD_LENGTH {
        message_bytes[i] = vaa[VAA_BODY_START + i];
    }
    // 2. extract the wormhole message id and constrain
    let message_id = message_bytes[0];
    assert(message_id == WORMHOLE_MESSAGE_ID, "Invalid payload ID");
    // 3. extract the source chain
    let source_chain_id = (message_bytes[1] as u16) * 256 + (message_bytes[2] as u16);
    // 4. extract the destination chain
    let destination_chain_id = (message_bytes[3] as u16) * 256 + (message_bytes[4] as u16);
    // 5. extract the sender address
    // note: we only take first 31 bytes
    let mut sender_bytes = [0; 31];
    for i in 0..31 {
        sender_bytes[i] = message_bytes[4 + i];
    }
    let sender = Field::from_le_bytes(sender_bytes);
    // 6. extract the value
    let value = message_bytes[37];
    // 7. compute nullifier
    let mut nullifier_preimage_bytes = [0; MESSAGE_NULLIFIER_LENGTH];
    let message_packed = pack_bytes(message_bytes);
    let nullifier = Poseidon2::hash(message_packed, MESSAGE_NULLIFIER_PACKED_LENGTH);
    
    DecodedVAAPayload {
        value,
        source_chain_id,
        destination_chain_id,
        sender,
        nullifier,
    }
}

/// Message payload encoding (39 bytes, big-endian):
///   Byte 0:      message_id (u8)
///   Bytes 1-2:   source_chain_id (u16)
///   Bytes 3-4:   destination_chain_id (u16)
///   Bytes 5-36:  sender (32 bytes)
///   Bytes 37-38: value (u16)
pub fn encode_message_payload(
    sender: [u8; 32],
    value: u8,
    source_chain_id: u16,
    destination_chain_id: u16,
) -> [[u8; 31]; 8] {
    let mut wormhole_payload: [[u8; 31]; 8] = [[0; 31]; 8];

    // Chunk 0: Control data
    let source_chain_bytes = u16_to_u8(source_chain_id);
    let destination_chain_bytes = u16_to_u8(destination_chain_id);
    wormhole_payload[0][0] = WORMHOLE_MESSAGE_ID;
    wormhole_payload[0][1] = source_chain_bytes[0];
    wormhole_payload[0][2] = source_chain_bytes[1];
    wormhole_payload[0][3] = destination_chain_bytes[0];
    wormhole_payload[0][4] = destination_chain_bytes[1];

    // Chunk 0: pack the bytes 0-25 of the sender
    for i in 0..25 {
        wormhole_payload[0][5 + i] = sender[i];
    }

    // Chunk 1: pack bytes 26-31 of the sender
    for i in 0..6 {
        wormhole_payload[1][i] = sender[26 + i];
    }

    // Chunk 2: place value at position 6
    wormhole_payload[2][6] = value;

    wormhole_payload
}


// actual constrained keccak hash of vaa body
pub fn compute_vaa_hash(body_bytes: [u8; 1860], body_length: u32) -> [u8; 32] {
    // Extract only the actual body content
    let mut actual_body = [0; 1860];
    for i in 0..body_length {
        actual_body[i] = body_bytes[i];
    }

    // Double hash as per Wormhole spec
    let hash: [u8; 32] = keccak256(actual_body, body_length);
    let double_hash: [u8; 32] = keccak256(hash, 32);

    double_hash
}
