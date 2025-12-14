/**
 * Common types and interface for MessageBridge clients across all chains.
 *
 * Each chain (EVM, Aztec, Solana) implements this interface, allowing
 * scripts to work with bridges in a chain-agnostic way.
 */

// ============================================================
// TYPES
// ============================================================

/**
 * Emitter registration configuration
 */
export interface EmitterConfig {
    /** Wormhole chain ID of the foreign chain */
    chainId: number;
    /** Emitter address as 0x-prefixed hex string (32 bytes, left-padded for EVM) */
    emitter: string;
    /** true for standard 18-byte payload (Solana/EVM), false for Aztec 50-byte payload */
    isDefaultPayload: boolean;
}

/**
 * Result of sending a cross-chain message
 */
export interface SendResult {
    /** Transaction hash or signature */
    txHash: string;
}

/**
 * Result of receiving a cross-chain message
 */
export interface ReceiveResult {
    /** Transaction hash or signature */
    txHash: string;
    /** The value that was received */
    value: bigint;
    /** Source chain ID */
    sourceChain: number;
}

// ============================================================
// INTERFACE
// ============================================================

/**
 * Base interface for MessageBridge clients.
 *
 * Implementations handle chain-specific details (signing, transaction building)
 * while exposing a common API for cross-chain operations.
 *
 * Note: Write operations require a signer, but signer types vary by chain:
 * - EVM: viem WalletClient or ethers Signer
 * - Aztec: Wallet with account
 * - Solana: Keypair
 *
 * Implementations should accept their chain's signer type in constructors
 * or as method parameters.
 */
export interface BaseMessageBridgeClient {
    // --------------------------------------------------------
    // IDENTITY
    // --------------------------------------------------------

    /** Wormhole chain ID for this chain */
    readonly wormholeChainId: number;

    /** Human-readable chain name */
    readonly chainName: string;

    /**
     * Get the emitter address for this bridge (for registration on other chains).
     * @returns 0x-prefixed hex string, 32 bytes (64 hex chars), left-padded for EVM addresses
     */
    getEmitterAddress(): string;

    // --------------------------------------------------------
    // READ OPERATIONS (no signer required)
    // --------------------------------------------------------

    /**
     * Check if the bridge contract/program is initialized
     */
    isInitialized(): Promise<boolean>;

    /**
     * Get the current stored value
     * @returns The value, or null if not set
     */
    getCurrentValue(): Promise<bigint | null>;

    /**
     * Check if a foreign emitter is registered
     * @param chainId - Wormhole chain ID of the foreign chain
     * @param emitter - Expected emitter address (0x-prefixed hex, 32 bytes)
     */
    isEmitterRegistered(chainId: number, emitter: string): Promise<boolean>;

    // --------------------------------------------------------
    // WRITE OPERATIONS (require signer - chain-specific)
    // --------------------------------------------------------

    /**
     * Register foreign emitters.
     *
     * Implementations should batch these into a single transaction where possible.
     *
     * @param emitters - Array of emitter configurations to register
     * @throws If caller is not the owner/admin
     */
    registerEmitters(emitters: EmitterConfig[]): Promise<void>;

    /**
     * Send a value to another chain via Wormhole.
     *
     * @param destinationChainId - Wormhole chain ID of the destination
     * @param value - The value to send (u128)
     * @returns Transaction result with hash
     */
    sendValue(destinationChainId: number, value: bigint): Promise<SendResult>;

    /**
     * Receive a value from another chain via Wormhole.
     *
     * @param vaa - The raw VAA bytes (signed by guardians)
     * @returns Transaction result with value and source chain
     */
    receiveValue(vaa: Uint8Array): Promise<ReceiveResult>;
}
