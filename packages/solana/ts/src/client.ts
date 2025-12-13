import {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    SYSVAR_CLOCK_PUBKEY,
    SYSVAR_RENT_PUBKEY,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
    SEED_CONFIG,
    SEED_CURRENT_VALUE,
    SEED_EMITTER,
    SEED_FOREIGN_EMITTER,
    SEED_MESSAGE,
    SEED_RECEIVED,
    SEED_WORMHOLE_BRIDGE,
    SEED_WORMHOLE_FEE_COLLECTOR,
    SEED_WORMHOLE_SEQUENCE,
    WORMHOLE_PROGRAM_ID,
    DISCRIMINATORS,
    CHAIN_ID_SOLANA,
} from "./constants.js";
import type {
    Config,
    CurrentValue,
    ForeignEmitter,
    MessageBridgeClientOptions,
    ProgramPDAs,
    ReceiveValueResult,
    SendValueResult,
    WormholePDAs,
} from "./types.js";

/**
 * Client for interacting with the Solana MessageBridge program
 */
export class MessageBridgeClient {
    readonly connection: Connection;
    readonly programId: PublicKey;
    readonly wormholeProgramId: PublicKey;
    private pdas: ProgramPDAs | null = null;
    private wormholePdas: WormholePDAs | null = null;

    constructor(connection: Connection, options: MessageBridgeClientOptions) {
        this.connection = connection;
        this.programId = options.programId;
        this.wormholeProgramId = options.wormholeProgramId ?? WORMHOLE_PROGRAM_ID;
    }

    /**
     * Get program PDAs (cached)
     */
    getPDAs(): ProgramPDAs {
        if (this.pdas) return this.pdas;

        const [config, configBump] = PublicKey.findProgramAddressSync(
            [SEED_CONFIG],
            this.programId
        );

        const [currentValue, currentValueBump] = PublicKey.findProgramAddressSync(
            [SEED_CURRENT_VALUE],
            this.programId
        );

        const [wormholeEmitter, wormholeEmitterBump] = PublicKey.findProgramAddressSync(
            [SEED_EMITTER],
            this.programId
        );

        this.pdas = {
            config,
            configBump,
            currentValue,
            currentValueBump,
            wormholeEmitter,
            wormholeEmitterBump,
        };

        return this.pdas;
    }

    /**
     * Get Wormhole PDAs (cached)
     */
    getWormholePDAs(): WormholePDAs {
        if (this.wormholePdas) return this.wormholePdas;

        const pdas = this.getPDAs();

        const [bridge, bridgeBump] = PublicKey.findProgramAddressSync(
            [SEED_WORMHOLE_BRIDGE],
            this.wormholeProgramId
        );

        const [feeCollector, feeCollectorBump] = PublicKey.findProgramAddressSync(
            [SEED_WORMHOLE_FEE_COLLECTOR],
            this.wormholeProgramId
        );

        const [sequence, sequenceBump] = PublicKey.findProgramAddressSync(
            [SEED_WORMHOLE_SEQUENCE, pdas.wormholeEmitter.toBuffer()],
            this.wormholeProgramId
        );

        this.wormholePdas = {
            bridge,
            bridgeBump,
            feeCollector,
            feeCollectorBump,
            sequence,
            sequenceBump,
        };

        return this.wormholePdas;
    }

    /**
     * Derive foreign emitter PDA for a given chain
     */
    getForeignEmitterPDA(chainId: number): [PublicKey, number] {
        const chainIdBuffer = Buffer.alloc(2);
        chainIdBuffer.writeUInt16LE(chainId);
        return PublicKey.findProgramAddressSync(
            [SEED_FOREIGN_EMITTER, chainIdBuffer],
            this.programId
        );
    }

    /**
     * Derive received message PDA
     */
    getReceivedMessagePDA(emitterChain: number, sequence: bigint): [PublicKey, number] {
        const chainIdBuffer = Buffer.alloc(2);
        chainIdBuffer.writeUInt16LE(emitterChain);
        const sequenceBuffer = Buffer.alloc(8);
        sequenceBuffer.writeBigUInt64LE(sequence);
        return PublicKey.findProgramAddressSync(
            [SEED_RECEIVED, chainIdBuffer, sequenceBuffer],
            this.programId
        );
    }

    /**
     * Derive message account PDA for sending
     */
    getMessagePDA(nonce: number): [PublicKey, number] {
        const nonceBuffer = Buffer.alloc(4);
        nonceBuffer.writeUInt32LE(nonce);
        return PublicKey.findProgramAddressSync(
            [SEED_MESSAGE, nonceBuffer],
            this.programId
        );
    }

    // ============================================================
    // INITIALIZE
    // ============================================================

    /**
     * Initialize the message bridge program
     */
    async initialize(payer: Keypair): Promise<string> {
        const pdas = this.getPDAs();
        const wormholePdas = this.getWormholePDAs();

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: pdas.config, isSigner: false, isWritable: true },
                { pubkey: pdas.currentValue, isSigner: false, isWritable: true },
                { pubkey: pdas.wormholeEmitter, isSigner: false, isWritable: true },
                { pubkey: this.wormholeProgramId, isSigner: false, isWritable: false },
                { pubkey: wormholePdas.bridge, isSigner: false, isWritable: true },
                { pubkey: wormholePdas.feeCollector, isSigner: false, isWritable: true },
                { pubkey: wormholePdas.sequence, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
                { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
            ],
            programId: this.programId,
            data: DISCRIMINATORS.initialize,
        });

        const tx = new Transaction().add(ix);
        return sendAndConfirmTransaction(this.connection, tx, [payer]);
    }

    // ============================================================
    // REGISTER EMITTER
    // ============================================================

    /**
     * Register a foreign emitter from another chain
     *
     * @param owner - The owner keypair (must be program owner)
     * @param chainId - Wormhole chain ID of the foreign chain
     * @param emitterAddress - Emitter address (32 bytes)
     * @param isDefaultPayload - true for default 18-byte payload (Solana/EVM), false for Aztec 50-byte payload
     */
    async registerEmitter(
        owner: Keypair,
        chainId: number,
        emitterAddress: Uint8Array,
        isDefaultPayload: boolean
    ): Promise<string> {
        if (emitterAddress.length !== 32) {
            throw new Error("Emitter address must be 32 bytes");
        }
        if (chainId === CHAIN_ID_SOLANA) {
            throw new Error("Cannot register Solana as a foreign emitter");
        }

        const pdas = this.getPDAs();
        const [foreignEmitter] = this.getForeignEmitterPDA(chainId);

        // Build instruction data: discriminator + chain_id (u16) + address (32 bytes) + is_default_payload (bool)
        const data = Buffer.alloc(8 + 2 + 32 + 1);
        DISCRIMINATORS.registerEmitter.copy(data, 0);
        data.writeUInt16LE(chainId, 8);
        Buffer.from(emitterAddress).copy(data, 10);
        data.writeUInt8(isDefaultPayload ? 1 : 0, 42);

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: owner.publicKey, isSigner: true, isWritable: true },
                { pubkey: pdas.config, isSigner: false, isWritable: false },
                { pubkey: foreignEmitter, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: this.programId,
            data,
        });

        const tx = new Transaction().add(ix);
        return sendAndConfirmTransaction(this.connection, tx, [owner]);
    }

    // ============================================================
    // SEND VALUE
    // ============================================================

    /**
     * Send a value to another chain via Wormhole
     */
    async sendValue(
        payer: Keypair,
        destinationChainId: number,
        value: bigint
    ): Promise<SendValueResult> {
        // First get current nonce from config
        const config = await this.getConfig();
        if (!config) {
            throw new Error("Message bridge not initialized");
        }

        const pdas = this.getPDAs();
        const wormholePdas = this.getWormholePDAs();
        const [messageKey] = this.getMessagePDA(config.nonce);

        // Build instruction data: discriminator + destination_chain_id (u16) + value (u128)
        const data = Buffer.alloc(8 + 2 + 16);
        DISCRIMINATORS.sendValue.copy(data, 0);
        data.writeUInt16LE(destinationChainId, 8);
        // Write u128 as two u64s (little endian)
        data.writeBigUInt64LE(value & BigInt("0xFFFFFFFFFFFFFFFF"), 10);
        data.writeBigUInt64LE(value >> BigInt(64), 18);

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: pdas.config, isSigner: false, isWritable: true },
                { pubkey: pdas.wormholeEmitter, isSigner: false, isWritable: false },
                { pubkey: this.wormholeProgramId, isSigner: false, isWritable: false },
                { pubkey: wormholePdas.bridge, isSigner: false, isWritable: true },
                { pubkey: wormholePdas.feeCollector, isSigner: false, isWritable: true },
                { pubkey: wormholePdas.sequence, isSigner: false, isWritable: true },
                { pubkey: messageKey, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
                { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
            ],
            programId: this.programId,
            data,
        });

        const tx = new Transaction().add(ix);
        const signature = await sendAndConfirmTransaction(this.connection, tx, [payer]);

        return {
            signature,
            nonce: config.nonce,
            messageKey,
        };
    }

    // ============================================================
    // RECEIVE VALUE
    // ============================================================

    /**
     * Receive a value from another chain via Wormhole
     */
    async receiveValue(
        payer: Keypair,
        postedVaa: PublicKey,
        vaaHash: Uint8Array,
        emitterChain: number,
        sequence: bigint
    ): Promise<ReceiveValueResult> {
        if (vaaHash.length !== 32) {
            throw new Error("VAA hash must be 32 bytes");
        }

        const pdas = this.getPDAs();
        const [foreignEmitter] = this.getForeignEmitterPDA(emitterChain);
        const [receivedMessage] = this.getReceivedMessagePDA(emitterChain, sequence);

        // Build instruction data: discriminator + vaa_hash (32 bytes) + emitter_chain (u16) + sequence (u64)
        const data = Buffer.alloc(8 + 32 + 2 + 8);
        DISCRIMINATORS.receiveValue.copy(data, 0);
        Buffer.from(vaaHash).copy(data, 8);
        data.writeUInt16LE(emitterChain, 40);
        data.writeBigUInt64LE(sequence, 42);

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: payer.publicKey, isSigner: true, isWritable: true },
                { pubkey: pdas.config, isSigner: false, isWritable: false },
                { pubkey: pdas.currentValue, isSigner: false, isWritable: true },
                { pubkey: this.wormholeProgramId, isSigner: false, isWritable: false },
                { pubkey: postedVaa, isSigner: false, isWritable: false },
                { pubkey: foreignEmitter, isSigner: false, isWritable: false },
                { pubkey: receivedMessage, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: this.programId,
            data,
        });

        const tx = new Transaction().add(ix);
        const signature = await sendAndConfirmTransaction(this.connection, tx, [payer]);

        // Read the value from current value account
        const currentValue = await this.getCurrentValue();

        return {
            signature,
            value: currentValue?.value ?? BigInt(0),
            sourceChain: emitterChain,
            sequence,
        };
    }

    // ============================================================
    // READ OPERATIONS
    // ============================================================

    /**
     * Get the program config
     */
    async getConfig(): Promise<Config | null> {
        const pdas = this.getPDAs();
        const accountInfo = await this.connection.getAccountInfo(pdas.config);
        if (!accountInfo) return null;

        // Parse config data (skip 8-byte discriminator)
        const data = accountInfo.data;
        return {
            owner: new PublicKey(data.subarray(8, 40)),
            wormholeProgram: new PublicKey(data.subarray(40, 72)),
            wormholeBridge: new PublicKey(data.subarray(72, 104)),
            wormholeFeeCollector: new PublicKey(data.subarray(104, 136)),
            wormholeEmitter: new PublicKey(data.subarray(136, 168)),
            wormholeSequence: new PublicKey(data.subarray(168, 200)),
            chainId: data.readUInt16LE(200),
            nonce: data.readUInt32LE(202),
        };
    }

    /**
     * Get the current value
     */
    async getCurrentValue(): Promise<CurrentValue | null> {
        const pdas = this.getPDAs();
        const accountInfo = await this.connection.getAccountInfo(pdas.currentValue);
        if (!accountInfo) return null;

        // Parse current value (skip 8-byte discriminator, read u128)
        const data = accountInfo.data;
        const low = data.readBigUInt64LE(8);
        const high = data.readBigUInt64LE(16);
        return {
            value: low + (high << BigInt(64)),
        };
    }

    /**
     * Get a registered foreign emitter
     */
    async getForeignEmitter(chainId: number): Promise<ForeignEmitter | null> {
        const [foreignEmitter] = this.getForeignEmitterPDA(chainId);
        const accountInfo = await this.connection.getAccountInfo(foreignEmitter);
        if (!accountInfo) return null;

        // Parse foreign emitter (skip 8-byte discriminator)
        // Layout: chain_id (2) + address (32) + is_default_payload (1)
        const data = accountInfo.data;
        return {
            chainId: data.readUInt16LE(8),
            address: new Uint8Array(data.subarray(10, 42)),
            isDefaultPayload: data.readUInt8(42) === 1,
        };
    }

    /**
     * Check if a message has been received (replay protection)
     */
    async isMessageReceived(emitterChain: number, sequence: bigint): Promise<boolean> {
        const [receivedMessage] = this.getReceivedMessagePDA(emitterChain, sequence);
        const accountInfo = await this.connection.getAccountInfo(receivedMessage);
        return accountInfo !== null;
    }

    // ============================================================
    // UTILITY METHODS
    // ============================================================

    /**
     * Check if the program is initialized
     */
    async isInitialized(): Promise<boolean> {
        const config = await this.getConfig();
        return config !== null;
    }

    /**
     * Get the emitter address (for registration on other chains)
     */
    getEmitterAddress(): Uint8Array {
        const pdas = this.getPDAs();
        return pdas.wormholeEmitter.toBytes();
    }

    /**
     * Convert an EVM address (20 bytes) to Wormhole format (32 bytes, left-padded)
     */
    static evmAddressToWormhole(evmAddress: string): Uint8Array {
        // Remove 0x prefix if present
        const cleanAddress = evmAddress.startsWith("0x")
            ? evmAddress.slice(2)
            : evmAddress;

        if (cleanAddress.length !== 40) {
            throw new Error("Invalid EVM address length");
        }

        // Left-pad to 32 bytes
        const result = new Uint8Array(32);
        const addressBytes = Buffer.from(cleanAddress, "hex");
        result.set(addressBytes, 12); // Start at byte 12 (32 - 20 = 12)
        return result;
    }

    /**
     * Convert an Aztec address (32 bytes) to Wormhole format
     */
    static aztecAddressToWormhole(aztecAddress: string): Uint8Array {
        // Remove 0x prefix if present
        const cleanAddress = aztecAddress.startsWith("0x")
            ? aztecAddress.slice(2)
            : aztecAddress;

        if (cleanAddress.length !== 64) {
            throw new Error("Invalid Aztec address length");
        }

        return new Uint8Array(Buffer.from(cleanAddress, "hex"));
    }
}
