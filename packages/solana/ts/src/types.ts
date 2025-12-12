import { PublicKey } from "@solana/web3.js";

/**
 * Program configuration account data
 */
export interface Config {
    owner: PublicKey;
    wormholeProgram: PublicKey;
    wormholeBridge: PublicKey;
    wormholeFeeCollector: PublicKey;
    wormholeEmitter: PublicKey;
    wormholeSequence: PublicKey;
    chainId: number;
    nonce: number;
}

/**
 * Foreign emitter registration
 */
export interface ForeignEmitter {
    chainId: number;
    address: Uint8Array; // 32 bytes
}

/**
 * Current value storage
 */
export interface CurrentValue {
    value: bigint;
}

/**
 * Received message (for replay protection)
 */
export interface ReceivedMessage {
    sequence: bigint;
    emitterChain: number;
    value: bigint;
    batchId: number;
}

/**
 * Wormhole emitter account
 */
export interface WormholeEmitter {
    bump: number;
}

/**
 * Counter account (for testing)
 */
export interface Counter {
    count: bigint;
}

/**
 * PDA addresses for the program
 */
export interface ProgramPDAs {
    config: PublicKey;
    configBump: number;
    currentValue: PublicKey;
    currentValueBump: number;
    wormholeEmitter: PublicKey;
    wormholeEmitterBump: number;
    counter: PublicKey;
    counterBump: number;
}

/**
 * Wormhole-related PDAs
 */
export interface WormholePDAs {
    bridge: PublicKey;
    bridgeBump: number;
    feeCollector: PublicKey;
    feeCollectorBump: number;
    sequence: PublicKey;
    sequenceBump: number;
}

/**
 * Options for initializing the client
 */
export interface MessageBridgeClientOptions {
    programId: PublicKey;
    wormholeProgramId?: PublicKey;
}

/**
 * Result of sending a value
 */
export interface SendValueResult {
    signature: string;
    nonce: number;
    messageKey: PublicKey;
}

/**
 * Result of receiving a value
 */
export interface ReceiveValueResult {
    signature: string;
    value: bigint;
    sourceChain: number;
    sequence: bigint;
}
