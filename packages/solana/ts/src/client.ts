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
import { wormhole, signSendWait, deserialize, type Wormhole } from "@wormhole-foundation/sdk";
import solana from "@wormhole-foundation/sdk/solana";
import { getSolanaSignAndSendSigner } from "@wormhole-foundation/sdk-solana";
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
    SEED_WORMHOLE_POSTED_VAA,
    WORMHOLE_PROGRAM_ID,
    DISCRIMINATORS,
} from "./constants";
import type {
    Config,
    CurrentValue,
    ForeignEmitter,
    ProgramPDAs,
    WormholePDAs,
} from "./types";
import {
    type BaseMessageBridgeReceiver,
    type EmitterConfig,
    parseVaa,
    WORMHOLE_CHAIN_IDS,
} from "@aztec-wormhole-demo/shared";

// ============================================================
// CLIENT OPTIONS
// ============================================================

export interface SolanaMessageBridgeClientOptions {
    connection: Connection;
    programId: PublicKey;
    payer: Keypair;
    wormholeProgramId?: PublicKey;
}

// ============================================================
// MESSAGE BRIDGE CLIENT
// ============================================================
export class SolanaMessageBridgeClient implements BaseMessageBridgeReceiver {
    readonly wormholeChainId = WORMHOLE_CHAIN_IDS.solana;
    readonly chainName = "Solana";

    readonly connection: Connection;
    readonly programId: PublicKey;
    readonly wormholeProgramId: PublicKey;
    private readonly payer: Keypair;
    private pdas: ProgramPDAs | null = null;
    private wormholePdas: WormholePDAs | null = null;

    private constructor(
        connection: Connection,
        programId: PublicKey,
        wormholeProgramId: PublicKey,
        payer: Keypair
    ) {
        this.connection = connection;
        this.programId = programId;
        this.wormholeProgramId = wormholeProgramId;
        this.payer = payer;
    }

    static async create(options: SolanaMessageBridgeClientOptions): Promise<SolanaMessageBridgeClient> {
        const wormholeProgramId = options.wormholeProgramId ?? WORMHOLE_PROGRAM_ID;
        return new SolanaMessageBridgeClient(
            options.connection,
            options.programId,
            wormholeProgramId,
            options.payer
        );
    }

    // ============================================================
    // PDA DERIVATION
    // ============================================================

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

    getForeignEmitterPDA(chainId: number): [PublicKey, number] {
        const chainIdBuffer = Buffer.alloc(2);
        chainIdBuffer.writeUInt16LE(chainId);
        return PublicKey.findProgramAddressSync(
            [SEED_FOREIGN_EMITTER, chainIdBuffer],
            this.programId
        );
    }

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

    getMessagePDA(nonce: number): [PublicKey, number] {
        const nonceBuffer = Buffer.alloc(4);
        nonceBuffer.writeUInt32LE(nonce);
        return PublicKey.findProgramAddressSync(
            [SEED_MESSAGE, nonceBuffer],
            this.programId
        );
    }

    // ============================================================
    // IDENTITY (BaseMessageBridgeClient)
    // ============================================================

    getEmitterAddress(): string {
        const pdas = this.getPDAs();
        return "0x" + Buffer.from(pdas.wormholeEmitter.toBytes()).toString("hex");
    }

    // ============================================================
    // READ OPERATIONS (BaseMessageBridgeClient)
    // ============================================================

    async isInitialized(): Promise<boolean> {
        const config = await this.getConfig();
        return config !== null;
    }

    async getCurrentValue(): Promise<bigint | null> {
        const pdas = this.getPDAs();
        const accountInfo = await this.connection.getAccountInfo(pdas.currentValue);
        if (!accountInfo) return null;

        const data = accountInfo.data;
        const low = data.readBigUInt64LE(8);
        const high = data.readBigUInt64LE(16);
        return low + (high << BigInt(64));
    }

    async isEmitterRegistered(chainId: number, emitter: string): Promise<boolean> {
        const foreignEmitter = await this.getForeignEmitter(chainId);
        if (!foreignEmitter) return false;

        const expectedBytes = Buffer.from(emitter.replace("0x", ""), "hex");
        return Buffer.from(foreignEmitter.address).equals(expectedBytes);
    }

    // ============================================================
    // WRITE OPERATIONS (BaseMessageBridgeClient)
    // ============================================================

    async registerEmitters(emitters: EmitterConfig[]): Promise<void> {
        if (emitters.length === 0) return;

        const pdas = this.getPDAs();
        const tx = new Transaction();

        for (const emitter of emitters) {
            const emitterAddress = new Uint8Array(
                Buffer.from(emitter.emitter.replace("0x", ""), "hex")
            );

            if (emitterAddress.length !== 32) {
                throw new Error(`Emitter address for chain ${emitter.chainId} must be 32 bytes`);
            }
            if (emitter.chainId === WORMHOLE_CHAIN_IDS.solana) {
                throw new Error("Cannot register Solana as a foreign emitter");
            }

            const [foreignEmitter] = this.getForeignEmitterPDA(emitter.chainId);

            const data = Buffer.alloc(8 + 2 + 32 + 1);
            DISCRIMINATORS.registerEmitter.copy(data, 0);
            data.writeUInt16LE(emitter.chainId, 8);
            Buffer.from(emitterAddress).copy(data, 10);
            data.writeUInt8(emitter.isDefaultPayload ? 1 : 0, 42);

            const ix = new TransactionInstruction({
                keys: [
                    { pubkey: this.payer.publicKey, isSigner: true, isWritable: true },
                    { pubkey: pdas.config, isSigner: false, isWritable: false },
                    { pubkey: foreignEmitter, isSigner: false, isWritable: true },
                    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                ],
                programId: this.programId,
                data,
            });

            tx.add(ix);
        }

        await sendAndConfirmTransaction(this.connection, tx, [this.payer]);
    }

    async sendValue(destinationChainId: number, value: bigint): Promise<string> {
        const config = await this.getConfig();
        if (!config) {
            throw new Error("Message bridge not initialized");
        }

        const pdas = this.getPDAs();
        const wormholePdas = this.getWormholePDAs();
        const [messageKey] = this.getMessagePDA(config.nonce);

        const data = Buffer.alloc(8 + 2 + 16);
        DISCRIMINATORS.sendValue.copy(data, 0);
        data.writeUInt16LE(destinationChainId, 8);
        data.writeBigUInt64LE(value & BigInt("0xFFFFFFFFFFFFFFFF"), 10);
        data.writeBigUInt64LE(value >> BigInt(64), 18);

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: this.payer.publicKey, isSigner: true, isWritable: true },
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
        return await sendAndConfirmTransaction(this.connection, tx, [this.payer]);
    }

    async receiveValue(vaaHex: string): Promise<string> {
        // Parse VAA hex to bytes
        const vaaBytes = Buffer.from(
            vaaHex.startsWith("0x") ? vaaHex.slice(2) : vaaHex,
            "hex"
        );
        const vaa = new Uint8Array(vaaBytes);

        // Parse VAA to get emitter chain, sequence, and body hash
        const { emitterChain, sequence, bodyHash } = parseVaa(vaa);

        // Derive PostedVAA PDA from body hash
        const [postedVaa] = PublicKey.findProgramAddressSync(
            [SEED_WORMHOLE_POSTED_VAA, bodyHash],
            this.wormholeProgramId
        );

        // Get program PDAs
        const pdas = this.getPDAs();
        const [foreignEmitter] = this.getForeignEmitterPDA(emitterChain);
        const [receivedMessage] = this.getReceivedMessagePDA(emitterChain, sequence);

        // Build instruction data: discriminator + vaa_hash (32) + emitter_chain (2) + sequence (8)
        const data = Buffer.alloc(8 + 32 + 2 + 8);
        DISCRIMINATORS.receiveValue.copy(data, 0);
        Buffer.from(bodyHash).copy(data, 8);
        data.writeUInt16LE(emitterChain, 40);
        data.writeBigUInt64LE(sequence, 42);

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: this.payer.publicKey, isSigner: true, isWritable: true },
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
        return await sendAndConfirmTransaction(this.connection, tx, [this.payer]);
    }

    // ============================================================
    // SOLANA-SPECIFIC OPERATIONS
    // ============================================================

    /**
     * Post a VAA to the Wormhole core bridge on Solana.
     * This is a prerequisite for calling receiveValue() - the VAA must be
     * posted to Wormhole before it can be consumed by the message bridge.
     *
     * @param vaaHex - VAA bytes as hex string
     * @returns Transaction signature, or "already_posted" if VAA exists
     */
    async postVaaToWormhole(vaaHex: string): Promise<string> {
        const vaaBytes = Buffer.from(
            vaaHex.startsWith("0x") ? vaaHex.slice(2) : vaaHex,
            "hex"
        );
        const vaa = new Uint8Array(vaaBytes);

        // Check if already posted
        const { bodyHash } = parseVaa(vaa);
        const [postedVaaPda] = PublicKey.findProgramAddressSync(
            [SEED_WORMHOLE_POSTED_VAA, bodyHash],
            this.wormholeProgramId
        );

        const existingAccount = await this.connection.getAccountInfo(postedVaaPda);
        if (existingAccount !== null) {
            return "already_posted";
        }

        // Initialize Wormhole SDK
        const wh = await wormhole("Devnet", [solana], {
            chains: {
                Solana: {
                    rpc: this.connection.rpcEndpoint,
                    contracts: {
                        coreBridge: this.wormholeProgramId.toBase58(),
                    },
                },
            },
        });

        // Get Solana chain context and core bridge
        const chain = wh.getChain("Solana");
        const coreBridge = await chain.getWormholeCore();

        // Deserialize VAA and create signer
        const parsedVaa = deserialize("Uint8Array", vaa);
        const signer = await getSolanaSignAndSendSigner(this.connection, this.payer, {
            retries: 3,
        });

        // Post the VAA (cast address - SDK types are loose with tsx)
        const verifyTxs = coreBridge.verifyMessage(signer.address() as any, parsedVaa);
        const txids = await signSendWait(chain, verifyTxs, signer);

        const lastTxid = txids[txids.length - 1];
        return lastTxid?.txid || "posted";
    }

    async initialize(): Promise<string> {
        const pdas = this.getPDAs();
        const wormholePdas = this.getWormholePDAs();

        const ix = new TransactionInstruction({
            keys: [
                { pubkey: this.payer.publicKey, isSigner: true, isWritable: true },
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
        return sendAndConfirmTransaction(this.connection, tx, [this.payer]);
    }

    async getConfig(): Promise<Config | null> {
        const pdas = this.getPDAs();
        const accountInfo = await this.connection.getAccountInfo(pdas.config);
        if (!accountInfo) return null;

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

    async getForeignEmitter(chainId: number): Promise<ForeignEmitter | null> {
        const [foreignEmitter] = this.getForeignEmitterPDA(chainId);
        const accountInfo = await this.connection.getAccountInfo(foreignEmitter);
        if (!accountInfo) return null;

        const data = accountInfo.data;
        return {
            chainId: data.readUInt16LE(8),
            address: new Uint8Array(data.subarray(10, 42)),
            isDefaultPayload: data.readUInt8(42) === 1,
        };
    }

    async isMessageReceived(emitterChain: number, sequence: bigint): Promise<boolean> {
        const [receivedMessage] = this.getReceivedMessagePDA(emitterChain, sequence);
        const accountInfo = await this.connection.getAccountInfo(receivedMessage);
        return accountInfo !== null;
    }
}
