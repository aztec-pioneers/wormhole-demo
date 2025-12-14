import {
    type PublicClient,
    type WalletClient,
    type Address,
    type Hex,
    getAddress,
} from "viem";
import {
    type BaseMessageBridgeClient,
    type EmitterConfig,
    type SendResult,
    type ReceiveResult,
    parseVaa,
    addressToBytes32,
} from "@aztec-wormhole-demo/shared";
import { MESSAGE_BRIDGE_ABI, WORMHOLE_ABI } from "./abi";

// ============================================================
// ABI (subset of MessageBridge.sol)
// ============================================================

// ============================================================
// CLIENT OPTIONS
// ============================================================

export interface EvmMessageBridgeClientOptions {
    /** Public client for reading */
    publicClient: PublicClient;
    /** Wallet client for writing */
    walletClient: WalletClient;
    /** Bridge contract address */
    bridgeAddress: Address;
    /** Human-readable chain name (e.g., "Arbitrum Sepolia") */
    chainName: string;
}

// ============================================================
// EVM MESSAGE BRIDGE CLIENT
// ============================================================

export class EvmMessageBridgeClient implements BaseMessageBridgeClient {
    readonly chainName: string;

    private readonly publicClient: PublicClient;
    private readonly walletClient: WalletClient;
    private readonly bridgeAddress: Address;
    private _wormholeChainId: number | null = null;
    private _wormholeAddress: Address | null = null;

    private constructor(
        publicClient: PublicClient,
        walletClient: WalletClient,
        bridgeAddress: Address,
        chainName: string,
    ) {
        this.publicClient = publicClient;
        this.walletClient = walletClient;
        this.bridgeAddress = getAddress(bridgeAddress);
        this.chainName = chainName;
    }

    static async create(options: EvmMessageBridgeClientOptions): Promise<EvmMessageBridgeClient> {
        const client = new EvmMessageBridgeClient(
            options.publicClient,
            options.walletClient,
            options.bridgeAddress,
            options.chainName,
        );

        // Load wormhole chain ID and address from contract
        const [chainId, wormholeAddress] = await Promise.all([
            client.publicClient.readContract({
                address: client.bridgeAddress,
                abi: MESSAGE_BRIDGE_ABI,
                functionName: "CHAIN_ID",
            }),
            client.publicClient.readContract({
                address: client.bridgeAddress,
                abi: MESSAGE_BRIDGE_ABI,
                functionName: "WORMHOLE",
            }),
        ]);

        client._wormholeChainId = chainId;
        client._wormholeAddress = wormholeAddress;

        return client;
    }

    // ============================================================
    // IDENTITY (BaseMessageBridgeClient)
    // ============================================================

    get wormholeChainId(): number {
        if (this._wormholeChainId === null) {
            throw new Error("Client not initialized");
        }
        return this._wormholeChainId;
    }

    getEmitterAddress(): string {
        // EVM emitter is the bridge contract address, left-padded to 32 bytes
        return addressToBytes32(this.bridgeAddress);
    }

    // ============================================================
    // READ OPERATIONS (BaseMessageBridgeClient)
    // ============================================================

    async isInitialized(): Promise<boolean> {
        try {
            await this.publicClient.readContract({
                address: this.bridgeAddress,
                abi: MESSAGE_BRIDGE_ABI,
                functionName: "owner",
            });
            return true;
        } catch {
            return false;
        }
    }

    async getCurrentValue(): Promise<bigint | null> {
        try {
            const value = await this.publicClient.readContract({
                address: this.bridgeAddress,
                abi: MESSAGE_BRIDGE_ABI,
                functionName: "currentValue",
            });
            return BigInt(value);
        } catch {
            return null;
        }
    }

    async isEmitterRegistered(chainId: number, emitter: string): Promise<boolean> {
        const registered = await this.publicClient.readContract({
            address: this.bridgeAddress,
            abi: MESSAGE_BRIDGE_ABI,
            functionName: "registeredEmitters",
            args: [chainId],
        });
        return registered.toLowerCase() === emitter.toLowerCase();
    }

    // ============================================================
    // WRITE OPERATIONS (BaseMessageBridgeClient)
    // ============================================================

    async registerEmitters(emitters: EmitterConfig[]): Promise<void> {
        if (emitters.length === 0) return;

        const account = this.walletClient.account;
        if (!account) {
            throw new Error("Wallet client has no account");
        }

        const hash = await this.walletClient.writeContract({
            address: this.bridgeAddress,
            abi: MESSAGE_BRIDGE_ABI,
            functionName: "registerEmitters",
            args: [
                emitters.map(e => e.chainId),
                emitters.map(e => e.emitter as Hex),
                emitters.map(e => e.isDefaultPayload),
            ],
            account,
            chain: this.walletClient.chain,
        });

        await this.publicClient.waitForTransactionReceipt({ hash });
    }

    async sendValue(destinationChainId: number, value: bigint): Promise<SendResult> {
        const account = this.walletClient.account;
        if (!account) {
            throw new Error("Wallet client has no account");
        }

        // Get Wormhole message fee
        const messageFee = await this.getMessageFee();

        const hash = await this.walletClient.writeContract({
            address: this.bridgeAddress,
            abi: MESSAGE_BRIDGE_ABI,
            functionName: "sendValue",
            args: [destinationChainId, value],
            value: messageFee,
            account,
            chain: this.walletClient.chain,
        });

        await this.publicClient.waitForTransactionReceipt({ hash });

        return { txHash: hash };
    }

    async receiveValue(vaa: Uint8Array): Promise<ReceiveResult> {
        const account = this.walletClient.account;
        if (!account) {
            throw new Error("Wallet client has no account");
        }

        const { emitterChain, value } = parseVaa(vaa);

        const hash = await this.walletClient.writeContract({
            address: this.bridgeAddress,
            abi: MESSAGE_BRIDGE_ABI,
            functionName: "receiveValue",
            args: [`0x${Buffer.from(vaa).toString("hex")}`],
            account,
            chain: this.walletClient.chain,
        });

        await this.publicClient.waitForTransactionReceipt({ hash });

        return {
            txHash: hash,
            value,
            sourceChain: emitterChain,
        };
    }

    // ============================================================
    // EVM-SPECIFIC OPERATIONS
    // ============================================================

    /**
     * Get the Wormhole message fee
     */
    async getMessageFee(): Promise<bigint> {
        if (!this._wormholeAddress) {
            throw new Error("Wormhole address not loaded");
        }

        return this.publicClient.readContract({
            address: this._wormholeAddress,
            abi: WORMHOLE_ABI,
            functionName: "messageFee",
        });
    }

    /**
     * Get the contract owner
     */
    async getOwner(): Promise<Address> {
        return this.publicClient.readContract({
            address: this.bridgeAddress,
            abi: MESSAGE_BRIDGE_ABI,
            functionName: "owner",
        });
    }
}
