export { SolanaMessageBridgeClient, type SolanaMessageBridgeClientOptions } from "./client.js";

export {
    WORMHOLE_CHAIN_ID_SOLANA,
    WORMHOLE_CHAIN_ID_ARBITRUM_SEPOLIA,
    WORMHOLE_CHAIN_ID_BASE_SEPOLIA,
    WORMHOLE_CHAIN_ID_AZTEC,
    SEED_CONFIG,
    SEED_CURRENT_VALUE,
    SEED_EMITTER,
    SEED_FOREIGN_EMITTER,
    SEED_MESSAGE,
    SEED_RECEIVED,
    SEED_WORMHOLE_BRIDGE,
    SEED_WORMHOLE_FEE_COLLECTOR,
    SEED_WORMHOLE_SEQUENCE,
    SEED_WORMHOLE_POSTED_VAA,
    WORMHOLE_PROGRAM_ID,
    DISCRIMINATORS,
} from "./constants.js";

export type {
    Config,
    CurrentValue,
    ForeignEmitter,
    ProgramPDAs,
    WormholePDAs,
} from "./types.js";
