import { PublicKey } from "@solana/web3.js";
import { WORMHOLE_CORE_BRIDGE_SOLANA_DEVNET } from "@aztec-wormhole-demo/shared";

// Wormhole Program ID (devnet default)
// Note: mainnet is "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth"
export const WORMHOLE_PROGRAM_ID = new PublicKey(WORMHOLE_CORE_BRIDGE_SOLANA_DEVNET);
