use aztec::protocol_types::traits::ToField;
use aztec::protocol_types::address::AztecAddress;

/// Payload ID for simple value messages (distinct from token bridge payloads)
pub global PAYLOAD_ID_MESSAGE: u8 = 99;

/// Encode message payload into Wormhole message format
///
/// Payload format (38 bytes):
/// - Byte 0:      Payload ID (99)
/// - Bytes 1-32:  Sender address (32 bytes)
/// - Byte 33:     Value (1 byte, 1-256 where 0 = 256)
/// - Bytes 34-35: Source chain ID (2 bytes, big-endian)
/// - Bytes 36-37: Destination chain ID (2 bytes, big-endian)
///
/// Returns [[u8; 31]; 8] for Wormhole publish_message (248 bytes total)
pub fn encode_message_payload(
    sender: [u8; 32],
    value: u8,
    source_chain_id: u16,
    destination_chain_id: u16,
) -> [[u8; 31]; 8] {
    // Create the 38-byte payload
    let mut payload: [u8; 38] = [0; 38];

    // Byte 0: payload ID
    payload[0] = PAYLOAD_ID_MESSAGE;

    // Bytes 1-32: sender address (32 bytes)
    for i in 0..32 {
        payload[1 + i] = sender[i];
    }

    // Byte 33: value
    payload[33] = value;

    // Bytes 34-35: source chain ID (2 bytes, big-endian)
    payload[34] = (source_chain_id >> 8) as u8;
    payload[35] = source_chain_id as u8;

    // Bytes 36-37: destination chain ID (2 bytes, big-endian)
    payload[36] = (destination_chain_id >> 8) as u8;
    payload[37] = destination_chain_id as u8;

    // Pack into Wormhole format: [[u8; 31]; 8] = 248 bytes total
    // Wormhole expects data in chunks of 31 bytes
    let mut wormhole_payload: [[u8; 31]; 8] = [[0; 31]; 8];

    for slot in 0..8 {
        for byte_idx in 0..31 {
            let payload_idx = slot * 31 + byte_idx;
            if payload_idx < 38 {
                wormhole_payload[slot][byte_idx] = payload[payload_idx];
            }
        }
    }

    wormhole_payload
}

pub fn address_to_bytes32(addr: AztecAddress) -> [u8; 32] {
    addr.to_field().to_be_bytes()
}
