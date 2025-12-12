// Main client export
export { MessageBridgeClient } from "./client.js";

// Constants
export {
    CHAIN_ID_SOLANA,
    CHAIN_ID_ETHEREUM,
    CHAIN_ID_ARBITRUM_SEPOLIA,
    CHAIN_ID_AZTEC,
    SEED_CONFIG,
    SEED_COUNTER,
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

// Types
export type {
    Config,
    Counter,
    CurrentValue,
    ForeignEmitter,
    MessageBridgeClientOptions,
    ProgramPDAs,
    ReceiveValueResult,
    ReceivedMessage,
    SendValueResult,
    WormholeEmitter,
    WormholePDAs,
} from "./types.js";
