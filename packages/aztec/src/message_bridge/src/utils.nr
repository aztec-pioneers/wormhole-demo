use aztec::protocol_types::traits::ToField;
use aztec::protocol_types::address::AztecAddress;

/// Payload ID for simple value messages (distinct from token bridge payloads)
pub global PAYLOAD_ID_MESSAGE: u8 = 99;

/// Encode message payload into Wormhole message format
///
/// The Wormhole contract converts each 31-byte chunk to a Field using from_le_bytes(),
/// which reverses the byte order. When guardians serialize the Field back to 32 bytes
/// (big-endian), the bytes appear reversed.
///
/// To ensure the value ends up at a predictable location in the final EVM payload,
/// we place it at position 0 of a chunk. After little-endian reversal and 32-byte
/// Field serialization, it will appear at the last position (byte 31) of that Field.
///
/// Payload structure (248 bytes = 8 chunks of 31 bytes):
/// - Chunk 0 (bytes 0-30):   [value, srcChainHi, srcChainLo, dstChainHi, dstChainLo, payloadId, zeros...]
/// - Chunk 1 (bytes 31-61):  [sender bytes 0-30]
/// - Chunk 2 (bytes 62-92):  [sender byte 31, zeros...]
/// - Chunks 3-7: zeros
///
/// After guardian serialization (5 header Fields + 8 payload Fields = 13 Fields x 32 bytes):
/// The EVM receives a payload where:
/// - Bytes 0-159: Header (sender, sequence, nonce, consistency, timestamp)
/// - Bytes 160-191: Field 5 = reversed chunk 0
/// - Bytes 192-223: Field 6 = reversed chunk 1
/// etc.
///
/// Value will be at: 160 (header) + 31 (last byte of reversed chunk 0) = byte 191
///
/// Returns [[u8; 31]; 8] for Wormhole publish_message (248 bytes total)
pub fn encode_message_payload(
    sender: [u8; 32],
    value: u8,
    source_chain_id: u16,
    destination_chain_id: u16,
) -> [[u8; 31]; 8] {
    let mut wormhole_payload: [[u8; 31]; 8] = [[0; 31]; 8];

    // Chunk 0: Control data
    // Place value at byte 0 - after LE reversal, it will be at the end of the Field
    wormhole_payload[0][0] = value;
    wormhole_payload[0][1] = (source_chain_id >> 8) as u8;
    wormhole_payload[0][2] = source_chain_id as u8;
    wormhole_payload[0][3] = (destination_chain_id >> 8) as u8;
    wormhole_payload[0][4] = destination_chain_id as u8;
    wormhole_payload[0][5] = PAYLOAD_ID_MESSAGE;

    // Chunk 1: First 31 bytes of sender
    for i in 0..31 {
        wormhole_payload[1][i] = sender[i];
    }

    // Chunk 2: Last byte of sender
    wormhole_payload[2][0] = sender[31];

    wormhole_payload
}

pub fn address_to_bytes32(addr: AztecAddress) -> [u8; 32] {
    addr.to_field().to_be_bytes()
}
