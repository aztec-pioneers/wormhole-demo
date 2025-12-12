import { PublicKey } from "@solana/web3.js";

// Wormhole Chain IDs
export const CHAIN_ID_SOLANA = 1;
export const CHAIN_ID_ETHEREUM = 2;
export const CHAIN_ID_ARBITRUM_SEPOLIA = 10003;
export const CHAIN_ID_AZTEC = 56;

// PDA Seeds
export const SEED_CONFIG = Buffer.from("config");
export const SEED_COUNTER = Buffer.from("counter");
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

// Wormhole Program ID (mainnet/devnet)
export const WORMHOLE_PROGRAM_ID = new PublicKey(
    "worm2ZoG2kUd4vFXhvjh93UUH596ayRfgQ2MgjNMTth"
);

// Instruction discriminators (from IDL)
export const DISCRIMINATORS = {
    initialize: Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]),
    registerEmitter: Buffer.from([217, 153, 40, 34, 190, 121, 144, 105]),
    sendValue: Buffer.from([165, 247, 104, 64, 24, 235, 166, 189]),
    receiveValue: Buffer.from([131, 101, 246, 45, 2, 139, 81, 21]),
    initializeCounter: Buffer.from([67, 89, 100, 87, 231, 172, 35, 124]),
    incrementCounter: Buffer.from([16, 125, 2, 171, 73, 24, 207, 229]),
    getCounter: Buffer.from([178, 42, 93, 7, 140, 213, 93, 150]),
} as const;
