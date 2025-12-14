import { PublicKey } from "@solana/web3.js";

// Re-export chain IDs from shared package
export {
    WORMHOLE_CHAIN_ID_SOLANA,
    WORMHOLE_CHAIN_ID_ARBITRUM_SEPOLIA,
    WORMHOLE_CHAIN_ID_BASE_SEPOLIA,
    WORMHOLE_CHAIN_ID_AZTEC,
    WORMHOLE_CORE_BRIDGE_SOLANA_DEVNET,
} from "@aztec-wormhole-demo/shared";

import { WORMHOLE_CORE_BRIDGE_SOLANA_DEVNET } from "@aztec-wormhole-demo/shared";

// PDA Seeds
export const SEED_CONFIG = Buffer.from("config");
export const SEED_EMITTER = Buffer.from("emitter");
export const SEED_FOREIGN_EMITTER = Buffer.from("foreign_emitter");
export const SEED_RECEIVED = Buffer.from("received");
export const SEED_CURRENT_VALUE = Buffer.from("current_value");
export const SEED_MESSAGE = Buffer.from("message");

// Wormhole Seeds (used for deriving Wormhole PDAs)
export const SEED_WORMHOLE_BRIDGE = Buffer.from("Bridge");
export const SEED_WORMHOLE_FEE_COLLECTOR = Buffer.from("fee_collector");
export const SEED_WORMHOLE_SEQUENCE = Buffer.from("Sequence");
export const SEED_WORMHOLE_POSTED_VAA = Buffer.from("PostedVAA");

// Wormhole Program ID (devnet default - matches wormhole-anchor-sdk "solana-devnet" feature)
// Override via SOLANA_WORMHOLE_PROGRAM_ID env var or wormholeProgramId client option
// Note: mainnet is "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth"
export const WORMHOLE_PROGRAM_ID = new PublicKey(WORMHOLE_CORE_BRIDGE_SOLANA_DEVNET);

// Instruction discriminators (from IDL)
export const DISCRIMINATORS = {
    initialize: Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]),
    registerEmitter: Buffer.from([217, 153, 40, 34, 190, 121, 144, 105]),
    sendValue: Buffer.from([165, 247, 104, 64, 24, 235, 166, 189]),
    receiveValue: Buffer.from([131, 101, 246, 45, 2, 139, 81, 21]),
} as const;
