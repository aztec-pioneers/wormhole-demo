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
    /** true = default 18-byte payload (Solana/EVM), false = Aztec 50-byte payload (with txId) */
    isDefaultPayload: boolean;
}

/**
 * Current value storage
 */
export interface CurrentValue {
    value: bigint;
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
