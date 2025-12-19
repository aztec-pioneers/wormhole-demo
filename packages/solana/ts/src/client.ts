import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import BN from "bn.js";
import { wormhole, signSendWait, deserialize } from "@wormhole-foundation/sdk";
import solana from "@wormhole-foundation/sdk/solana";
import { getSolanaSignAndSendSigner } from "@wormhole-foundation/sdk-solana";
import { WORMHOLE_PROGRAM_ID } from "./constants.js";
import type { MessageBridge } from "./idl/message_bridge.js";
import idl from "./idl/message_bridge.json" with { type: "json" };
import {
    type BaseMessageBridgeReceiver,
    type EmitterConfig,
    parseVaa,
    WORMHOLE_CHAIN_IDS,
} from "@aztec-wormhole-demo/shared";

export interface SolanaMessageBridgeClientOptions {
    connection: Connection;
    programId: PublicKey;
    payer: Keypair;
    wormholeProgramId?: PublicKey;
}

export class SolanaMessageBridgeClient implements BaseMessageBridgeReceiver {
    readonly wormholeChainId = WORMHOLE_CHAIN_IDS.solana;
    readonly chainName = "Solana";
    readonly connection: Connection;
    readonly programId: PublicKey;
    readonly wormholeProgramId: PublicKey;
    private readonly payer: Keypair;
    private readonly program: Program<MessageBridge>;

    private constructor(
        connection: Connection,
        programId: PublicKey,
        wormholeProgramId: PublicKey,
        payer: Keypair,
        program: Program<MessageBridge>
    ) {
        this.connection = connection;
        this.programId = programId;
        this.wormholeProgramId = wormholeProgramId;
        this.payer = payer;
        this.program = program;
    }

    static async create(options: SolanaMessageBridgeClientOptions): Promise<SolanaMessageBridgeClient> {
        const wormholeProgramId = options.wormholeProgramId ?? WORMHOLE_PROGRAM_ID;
        const wallet = new Wallet(options.payer);
        const provider = new AnchorProvider(options.connection, wallet, { commitment: "confirmed" });
        // Override the IDL address with the provided programId
        const idlWithAddress = { ...idl, address: options.programId.toBase58() };
        const program = new Program<MessageBridge>(idlWithAddress as MessageBridge, provider);

        return new SolanaMessageBridgeClient(
            options.connection,
            options.programId,
            wormholeProgramId,
            options.payer,
            program
        );
    }

    // Helper to derive PDAs
    private pda(seeds: (Buffer | Uint8Array)[], programId = this.programId): PublicKey {
        return PublicKey.findProgramAddressSync(seeds, programId)[0];
    }

    getEmitterAddress(): string {
        return "0x" + this.pda([Buffer.from("emitter")]).toBuffer().toString("hex");
    }

    async isInitialized(): Promise<boolean> {
        return (await this.getConfig()) !== null;
    }

    async getCurrentValue(): Promise<bigint | null> {
        try {
            const account = await this.program.account.currentValue.fetch(
                this.pda([Buffer.from("current_value")])
            );
            return BigInt(account.value.toString());
        } catch {
            return null;
        }
    }

    async isEmitterRegistered(chainId: number, emitter: string): Promise<boolean> {
        const foreignEmitter = await this.getForeignEmitter(chainId);
        if (!foreignEmitter) return false;
        const expectedBytes = Buffer.from(emitter.replace("0x", ""), "hex");
        return Buffer.from(foreignEmitter.address).equals(expectedBytes);
    }

    async registerEmitters(emitters: EmitterConfig[]): Promise<void> {
        for (const emitter of emitters) {
            const emitterAddress = Array.from(Buffer.from(emitter.emitter.replace("0x", ""), "hex"));
            if (emitterAddress.length !== 32) throw new Error(`Emitter address must be 32 bytes`);
            if (emitter.chainId === WORMHOLE_CHAIN_IDS.solana) throw new Error("Cannot register Solana");

            await this.program.methods
                .registerEmitter(emitter.chainId, emitterAddress, emitter.isDefaultPayload)
                .accounts({ owner: this.payer.publicKey })
                .rpc();
        }
    }

    async sendValue(destinationChainId: number, value: bigint): Promise<string> {
        const emitterPda = this.pda([Buffer.from("emitter")]);
        return await this.program.methods
            .sendValue(destinationChainId, new BN(value.toString()))
            .accounts({
                payer: this.payer.publicKey,
                wormholeBridge: this.pda([Buffer.from("Bridge")], this.wormholeProgramId),
                wormholeFeeCollector: this.pda([Buffer.from("fee_collector")], this.wormholeProgramId),
                wormholeSequence: this.pda([Buffer.from("Sequence"), emitterPda.toBuffer()], this.wormholeProgramId),
            })
            .rpc();
    }

    async receiveValue(vaaHex: string): Promise<string> {
        const vaaBytes = Buffer.from(vaaHex.replace(/^0x/, ""), "hex");
        const { emitterChain, sequence, bodyHash } = parseVaa(new Uint8Array(vaaBytes));

        return await this.program.methods
            .receiveValue(Array.from(bodyHash), emitterChain, new BN(sequence.toString()))
            .accounts({
                payer: this.payer.publicKey,
                postedVaa: this.pda([Buffer.from("PostedVAA"), bodyHash], this.wormholeProgramId),
            })
            .rpc();
    }

    async postVaaToWormhole(vaaHex: string): Promise<string> {
        const vaaBytes = Buffer.from(vaaHex.replace(/^0x/, ""), "hex");
        const vaa = new Uint8Array(vaaBytes);
        const { bodyHash } = parseVaa(vaa);
        const postedVaaPda = this.pda([Buffer.from("PostedVAA"), bodyHash], this.wormholeProgramId);

        if (await this.connection.getAccountInfo(postedVaaPda)) return "already_posted";

        const wh = await wormhole("Devnet", [solana], {
            chains: { Solana: { rpc: this.connection.rpcEndpoint, contracts: { coreBridge: this.wormholeProgramId.toBase58() } } },
        });
        const chain = wh.getChain("Solana");
        const coreBridge = await chain.getWormholeCore();
        const parsedVaa = deserialize("Uint8Array", vaa);
        const signer = await getSolanaSignAndSendSigner(this.connection, this.payer, { retries: 3 });
        const txids = await signSendWait(chain, coreBridge.verifyMessage(signer.address() as any, parsedVaa), signer);
        return txids[txids.length - 1]?.txid || "posted";
    }

    async initialize(): Promise<string> {
        return await this.program.methods
            .initialize()
            .accounts({ owner: this.payer.publicKey })
            .rpc();
    }

    async getConfig() {
        try {
            return await this.program.account.config.fetch(this.pda([Buffer.from("config")]));
        } catch {
            return null;
        }
    }

    async getForeignEmitter(chainId: number) {
        try {
            const chainIdBuf = Buffer.alloc(2);
            chainIdBuf.writeUInt16LE(chainId);
            return await this.program.account.foreignEmitter.fetch(
                this.pda([Buffer.from("foreign_emitter"), chainIdBuf])
            );
        } catch {
            return null;
        }
    }

    async isMessageReceived(emitterChain: number, sequence: bigint): Promise<boolean> {
        try {
            const chainBuf = Buffer.alloc(2);
            chainBuf.writeUInt16LE(emitterChain);
            const seqBuf = Buffer.alloc(8);
            seqBuf.writeBigUInt64LE(sequence);
            await this.program.account.receivedMessage.fetch(this.pda([Buffer.from("received"), chainBuf, seqBuf]));
            return true;
        } catch {
            return false;
        }
    }
}
