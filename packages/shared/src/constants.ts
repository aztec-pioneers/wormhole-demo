export const MAX_U128 = 2n ** 128n - 1n;

export const AVAILABLE_NETWORKS = ["arbitrum", "base", "aztec", "solana"];
export type NetworkName = (typeof AVAILABLE_NETWORKS)[number];


// Wormhole Chain IDs
// See: https://docs.wormhole.com/wormhole/reference/constants
export const WORMHOLE_CHAIN_IDS: Record<NetworkName, number> = {
    arbitrum: 10003,
    base: 10004,
    aztec: 56,
    solana: 1,
};

export const EXPLORERS: Record<NetworkName, { name: string; txUrl: (hash: string) => string }> = {
    arbitrum: { name: "Arbiscan", txUrl: h => `https://sepolia.arbiscan.io/tx/${h}` },
    base: { name: "Basescan", txUrl: h => `https://sepolia.basescan.org/tx/${h}` },
    solana: { name: "Solana Explorer", txUrl: h => `https://explorer.solana.com/tx/${h}?cluster=devnet` },
    aztec: { name: "Aztecscan", txUrl: h => `https://devnet.aztecscan.xyz/tx-effects/${h}` },
};

// Wormhole Core Bridge Program IDs
// See: https://docs.wormhole.com/wormhole/reference/contracts
export const WORMHOLE_CORE_BRIDGE_SOLANA_DEVNET = "3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5";
