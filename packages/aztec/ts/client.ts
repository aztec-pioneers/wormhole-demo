import { AztecAddress } from "@aztec/aztec.js/addresses";
import type { AztecNode } from "@aztec/aztec.js/node";
import type { Wallet } from "@aztec/aztec.js/wallet";
import { Fr } from "@aztec/aztec.js/fields";
import type { SendInteractionOptions, WaitOpts } from "@aztec/aztec.js/contracts";
import {
    type BaseMessageBridgeReceiver,
    type EmitterConfig,
    WORMHOLE_CHAIN_IDS,
    hexToBytes32Array,
    addressToBytes32,
} from "@aztec-wormhole-demo/shared";
import { MessageBridgeContract, MessageBridgeContractArtifact, WormholeContractArtifact } from "./artifacts/index.js";

export interface AztecMessageBridgeClientOptions {
    /** Aztec node client */
    node: AztecNode;
    /** Wallet instance */
    wallet: Wallet;
    /** Bridge contract address */
    bridgeAddress: AztecAddress;
    /** Wormhole contract address (for emitter) */
    wormholeAddress: AztecAddress;
    /** Account address to use for transactions */
    accountAddress: AztecAddress;
    /** Send options (fee settings, etc.) */
    sendOptions?: SendInteractionOptions;
    /** Wait options (timeout, interval) */
    waitOptions?: WaitOpts;
}

/**
 * Client for interacting with the Aztec MessageBridge contract.
 *
 * Implements BaseMessageBridgeReceiver for cross-chain compatibility.
 */
export class AztecMessageBridgeClient implements BaseMessageBridgeReceiver {
    readonly wormholeChainId = WORMHOLE_CHAIN_IDS.aztec;
    readonly chainName = "Aztec";

    private readonly wormholeAddress: AztecAddress;
    private readonly accountAddress: AztecAddress;
    private readonly sendOptions: SendInteractionOptions;
    private readonly waitOptions: WaitOpts;
    private readonly bridge: MessageBridgeContract;

    private constructor(
        bridge: MessageBridgeContract,
        wormholeAddress: AztecAddress,
        accountAddress: AztecAddress,
        sendOptions: SendInteractionOptions,
        waitOptions: WaitOpts,
    ) {
        this.bridge = bridge;
        this.wormholeAddress = wormholeAddress;
        this.accountAddress = accountAddress;
        this.sendOptions = sendOptions;
        this.waitOptions = waitOptions;
    }

    /**
     * Create a new AztecMessageBridgeClient
     */
    static async create(options: AztecMessageBridgeClientOptions): Promise<AztecMessageBridgeClient> {
        // Register Wormhole contract (needed for cross-chain calls)
        const wormholeInstance = await options.node.getContract(options.wormholeAddress);
        if (!wormholeInstance) {
            throw new Error(`Wormhole contract not found at ${options.wormholeAddress}`);
        }
        await options.wallet.registerContract(wormholeInstance, WormholeContractArtifact);

        // Register MessageBridge contract
        const bridgeInstance = await options.node.getContract(options.bridgeAddress);
        if (!bridgeInstance) {
            throw new Error(`Aztec bridge contract not found at ${options.bridgeAddress}`);
        }
        await options.wallet.registerContract(bridgeInstance, MessageBridgeContractArtifact);

        const bridge = await MessageBridgeContract.at(options.bridgeAddress, options.wallet);

        return new AztecMessageBridgeClient(
            bridge,
            options.wormholeAddress,
            options.accountAddress,
            options.sendOptions ?? { from: options.accountAddress },
            options.waitOptions ?? { timeout: 3600, interval: 3 },
        );
    }

    // --------------------------------------------------------
    // IDENTITY
    // --------------------------------------------------------

    getEmitterAddress(): string {
        // Aztec emitter is the Wormhole contract address
        return addressToBytes32(this.wormholeAddress.toString());
    }

    // --------------------------------------------------------
    // READ OPERATIONS
    // --------------------------------------------------------

    async isInitialized(): Promise<boolean> {
        try {
            await this.bridge.methods.get_config().simulate({ from: this.accountAddress });
            return true;
        } catch {
            return false;
        }
    }

    async getCurrentValue(): Promise<bigint | null> {
        try {
            const value = await this.bridge.methods
                .get_current_value()
                .simulate({ from: this.accountAddress });
            return BigInt(value.toString());
        } catch {
            return null;
        }
    }

    async isEmitterRegistered(chainId: number, emitter: string): Promise<boolean> {
        const emitterBytes = hexToBytes32Array(emitter);
        return this.bridge.methods
            .is_emitter_registered(chainId, emitterBytes as any)
            .simulate({ from: this.accountAddress });
    }

    // --------------------------------------------------------
    // WRITE OPERATIONS
    // --------------------------------------------------------

    async registerEmitters(emitters: EmitterConfig[]): Promise<void> {
        if (emitters.length === 0) return;

        const chainIds = emitters.map(e => e.chainId);
        const emitterAddresses = emitters.map(e => hexToBytes32Array(e.emitter));

        await this.bridge.methods
            .register_emitter(chainIds as any, emitterAddresses as any)
            .send(this.sendOptions)
            .wait(this.waitOptions);
    }

    async sendValue(destinationChainId: number, value: bigint): Promise<string> {
        // default to private send
        return this.sendValuePrivate(destinationChainId, value);
    }

    // --------------------------------------------------------
    // AZTEC-SPECIFIC METHODS
    // --------------------------------------------------------

    /**
     * Send value publicly (visible on-chain)
     */
    async sendValuePublic(destinationChainId: number, value: bigint): Promise<string> {
        const feeNonce = Fr.random();
       return await this.bridge.methods
            .send_value_public(destinationChainId, value, feeNonce)
            .send(this.sendOptions)
            .wait(this.waitOptions)
            .then(receipt => receipt.txHash.toString());
    }

    /**
     * Send value privately (encrypted)
     */
    async sendValuePrivate(destinationChainId: number, value: bigint): Promise<string> {
        // no message fee used
        const feeNonce = Fr.random();
        return await this.bridge.methods
            .send_value_private(destinationChainId, value, feeNonce)
            .send(this.sendOptions)
            .wait(this.waitOptions)
            .then(receipt => receipt.txHash.toString());
    }

    /**
     * Receive value from a VAA
     * @param vaaHex - VAA bytes as hex string
     * @param sendOptionsOverride - Optional override for send options (e.g., custom fees)
     */
    async receiveValue(vaaHex: string, sendOptionsOverride?: SendInteractionOptions): Promise<string> {
        // 1. parse VAA hex
        const vaaBuffer = Buffer.from(vaaHex.startsWith('0x') ? vaaHex.slice(2) : vaaHex, 'hex');

        // 2. Pad VAA for circuit input
        const paddedVAA = Buffer.alloc(2000);
        vaaBuffer.copy(paddedVAA, 0, 0, Math.min(vaaBuffer.length, 2000));
        const vaaBytes = Array.from(paddedVAA);
        const vaaLength = vaaBuffer.length;

        // 3. Call receive_value on the bridge
        return await this.bridge.methods
            .receive_value(vaaBytes, vaaLength)
            .send(sendOptionsOverride ?? this.sendOptions)
            .wait(this.waitOptions)
            .then(receipt => receipt.txHash.toString());
    }

    /**
     * Get the contract owner
     */
    async getOwner(): Promise<AztecAddress> {
        return this.bridge.methods.get_owner().simulate({ from: this.accountAddress });
    }
}
