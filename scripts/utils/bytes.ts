/**
 * Convert an address to bytes32 (left-padded with zeros)
 */
export function addressToBytes32(address: string): `0x${string}` {
    const clean = address.replace("0x", "").toLowerCase();
    return `0x${clean.padStart(64, "0")}` as `0x${string}`;
}

/**
 * Convert a hex string to a [u8; 32] array for Aztec
 */
export function hexToBytes32Array(hex: string): number[] {
    const clean = hex.replace("0x", "").padStart(64, "0");
    const bytes: number[] = [];
    for (let i = 0; i < 64; i += 2) {
        bytes.push(parseInt(clean.substring(i, i + 2), 16));
    }
    return bytes;
}

/**
 * Convert a [u8; 32] array to hex string
 */
export function bytes32ArrayToHex(bytes: number[]): `0x${string}` {
    return `0x${bytes.map(b => b.toString(16).padStart(2, "0")).join("")}` as `0x${string}`;
}
