import { keccak_256 } from "@noble/hashes/sha3";

// NOTE: We manually parse VAAs instead of using @wormhole-foundation/sdk-definitions
// because the SDK's chainToChainId() doesn't recognize Aztec (custom chain).
// The SDK would throw on VAAs from Aztec, breaking cross-chain receive.
export interface ParsedVaa {
    emitterChain: number;
    destinationChain: number;
    sequence: bigint;
    value: bigint;
    /** keccak256 hash of VAA body - used for Solana PDA derivation */
    bodyHash: Uint8Array;
}

/**
 * Parse a Wormhole VAA to extract cross-chain message data.
 *
 * VAA structure:
 * - version (1 byte)
 * - guardian_set_index (4 bytes)
 * - signature_count (1 byte)
 * - signatures (66 bytes each)
 * - [body starts here]
 * - timestamp (4 bytes)
 * - nonce (4 bytes)
 * - emitter_chain (2 bytes, big endian)
 * - emitter_address (32 bytes)
 * - sequence (8 bytes, big endian)
 * - consistency_level (1 byte)
 * - payload (variable)
 *
 * Payload format (our custom):
 * - destination_chain (2 bytes, big endian)
 * - value (16 bytes, u128 big endian)
 */
export function parseVaa(vaa: Uint8Array): ParsedVaa {
    const sigCount = vaa[5];
    const bodyStart = 6 + sigCount * 66;

    // Hash the body for Solana PDA derivation
    const body = vaa.slice(bodyStart);
    const bodyHash = keccak_256(body);

    // emitter_chain at bodyStart + 8 (after timestamp + nonce)
    const emitterChain = (vaa[bodyStart + 8] << 8) | vaa[bodyStart + 9];

    // sequence at bodyStart + 42 (after timestamp + nonce + emitter_chain + emitter_address)
    let sequence = 0n;
    for (let i = 0; i < 8; i++) {
        sequence = (sequence << 8n) | BigInt(vaa[bodyStart + 42 + i]);
    }

    // payload starts at bodyStart + 51
    // Payload format: destination_chain (2 bytes, big endian) + value (16 bytes, u128 big endian)
    const payloadStart = bodyStart + 51;
    const destinationChain = (vaa[payloadStart] << 8) | vaa[payloadStart + 1];

    let value = 0n;
    for (let i = 0; i < 16; i++) {
        value = (value << 8n) | BigInt(vaa[payloadStart + 2 + i]);
    }

    return { emitterChain, destinationChain, sequence, value, bodyHash };
}
