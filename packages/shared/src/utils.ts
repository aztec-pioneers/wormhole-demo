/**
 * Convert a value to a given decimal precision (default 18 decimals)
 */
export const precision = (n: bigint = 1n, decimals: bigint = 18n) =>
    n * 10n ** decimals;

/**
 * Convert a hex string to a [u8; 32] array
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
 * Convert an address to bytes32 hex string (left-padded with zeros)
 */
export function addressToBytes32(address: string): string {
    const clean = address.replace("0x", "").toLowerCase();
    return `0x${clean.padStart(64, "0")}`;
}
