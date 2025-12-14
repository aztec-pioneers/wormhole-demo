#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();

import { getAddress } from "viem";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { TestWallet } from "@aztec/test-wallet/server";
import { MessageBridgeContract, MessageBridgeContractArtifact } from "@aztec-wormhole-demo/aztec-contracts/artifacts";
import { loadAccount, getTestnetPxeConfig, testnetSendWaitOpts } from "./utils/aztec";
import { addressToBytes32, hexToBytes32Array } from "./utils/bytes";
import { createEvmClients, MESSAGE_BRIDGE_ABI, EvmChainName } from "./utils/evm";
import { createSolanaClient, loadKeypair, formatEmitterAddress } from "./utils/solana";
import {
    WORMHOLE_CHAIN_ID_SOLANA,
    WORMHOLE_CHAIN_ID_ARBITRUM_SEPOLIA,
    WORMHOLE_CHAIN_ID_BASE_SEPOLIA,
    WORMHOLE_CHAIN_ID_AZTEC,
} from "@aztec-wormhole-demo/solana-sdk";

// Required env vars
const env = {
    AZTEC_NODE_URL: process.env.AZTEC_NODE_URL!,
    ARBITRUM_RPC_URL: process.env.ARBITRUM_RPC_URL!,
    BASE_RPC_URL: process.env.BASE_RPC_URL!,
    EVM_PRIVATE_KEY: process.env.EVM_PRIVATE_KEY!,
    AZTEC_BRIDGE_ADDRESS: process.env.AZTEC_BRIDGE_ADDRESS!,
    ARBITRUM_BRIDGE_ADDRESS: process.env.ARBITRUM_BRIDGE_ADDRESS!,
    BASE_BRIDGE_ADDRESS: process.env.BASE_BRIDGE_ADDRESS!,
    AZTEC_WORMHOLE_ADDRESS: process.env.AZTEC_WORMHOLE_ADDRESS!,
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL!,
    SOLANA_BRIDGE_PROGRAM_ID: process.env.SOLANA_BRIDGE_PROGRAM_ID!,
};

for (const [key, value] of Object.entries(env)) {
    if (!value) throw new Error(`${key} not set in .env`);
}

// Chain definitions
type ChainId = "arbitrum" | "base" | "aztec" | "solana";

interface Chain {
    name: string;
    wormholeChainId: number;
    getEmitterAddress: () => string;
    isDefaultPayload: boolean; // false for Aztec (50-byte payload with txId), true for others (18-byte)
}

const CHAINS: Record<ChainId, Chain> = {
    arbitrum: {
        name: "Arbitrum",
        wormholeChainId: WORMHOLE_CHAIN_ID_ARBITRUM_SEPOLIA,
        getEmitterAddress: () => addressToBytes32(env.ARBITRUM_BRIDGE_ADDRESS),
        isDefaultPayload: true,
    },
    base: {
        name: "Base",
        wormholeChainId: WORMHOLE_CHAIN_ID_BASE_SEPOLIA,
        getEmitterAddress: () => addressToBytes32(env.BASE_BRIDGE_ADDRESS),
        isDefaultPayload: true,
    },
    aztec: {
        name: "Aztec",
        wormholeChainId: WORMHOLE_CHAIN_ID_AZTEC,
        getEmitterAddress: () => addressToBytes32(env.AZTEC_WORMHOLE_ADDRESS),
        isDefaultPayload: false,
    },
    solana: {
        name: "Solana",
        wormholeChainId: WORMHOLE_CHAIN_ID_SOLANA,
        getEmitterAddress: () => {
            const { client } = createSolanaClient(env.SOLANA_RPC_URL, env.SOLANA_BRIDGE_PROGRAM_ID);
            return formatEmitterAddress(client.getEmitterAddress());
        },
        isDefaultPayload: true,
    },
};

interface EmitterToRegister {
    chainId: number;
    emitter: string;
    isDefaultPayload: boolean;
}

interface ChainAdapter {
    isEmitterRegistered(targetChainId: number, expectedEmitter: string): Promise<boolean>;
    registerEmitters(emitters: EmitterToRegister[]): Promise<void>;
}

async function createEvmAdapter(rpcUrl: string, bridgeAddress: string, chainName: EvmChainName): Promise<ChainAdapter> {
    const { account, publicClient, walletClient } = createEvmClients(rpcUrl, env.EVM_PRIVATE_KEY, chainName);
    const address = getAddress(bridgeAddress);

    // Verify ownership
    const owner = await publicClient.readContract({
        address,
        abi: MESSAGE_BRIDGE_ABI,
        functionName: "owner",
    }) as string;
    if (owner.toLowerCase() !== account.address.toLowerCase()) {
        throw new Error(`Not owner. Owner: ${owner}, You: ${account.address}`);
    }

    return {
        async isEmitterRegistered(targetChainId: number, expectedEmitter: string): Promise<boolean> {
            const registered = await publicClient.readContract({
                address,
                abi: MESSAGE_BRIDGE_ABI,
                functionName: "registeredEmitters",
                args: [targetChainId],
            }) as `0x${string}`;
            return registered.toLowerCase() === expectedEmitter.toLowerCase();
        },
        async registerEmitters(emitters: EmitterToRegister[]): Promise<void> {
            const hash = await walletClient.writeContract({
                address,
                abi: MESSAGE_BRIDGE_ABI,
                functionName: "registerEmitters",
                args: [
                    emitters.map(e => e.chainId),
                    emitters.map(e => e.emitter as `0x${string}`),
                    emitters.map(e => e.isDefaultPayload),
                ],
            });
            await publicClient.waitForTransactionReceipt({ hash });
        },
    };
}

async function createAztecAdapter(): Promise<ChainAdapter> {
    const node = createAztecNodeClient(env.AZTEC_NODE_URL);
    const wallet = await TestWallet.create(node, getTestnetPxeConfig());
    const adminAddress = await loadAccount(node, wallet);

    const bridgeAddress = AztecAddress.fromString(env.AZTEC_BRIDGE_ADDRESS);
    const instance = await node.getContract(bridgeAddress);
    if (!instance) throw new Error("Aztec bridge contract not found");
    await wallet.registerContract(instance, MessageBridgeContractArtifact);

    const bridge = await MessageBridgeContract.at(bridgeAddress, wallet);

    // Verify ownership
    const owner = await bridge.methods.get_owner().simulate({ from: adminAddress });
    if (!owner.equals(adminAddress)) {
        throw new Error(`Not owner. Owner: ${owner}, You: ${adminAddress}`);
    }

    const opts = await testnetSendWaitOpts(node, wallet, adminAddress);

    return {
        async isEmitterRegistered(targetChainId: number, expectedEmitter: string): Promise<boolean> {
            const emitterBytes = hexToBytes32Array(expectedEmitter);
            return bridge.methods
                .is_emitter_registered(targetChainId, emitterBytes as any)
                .simulate({ from: adminAddress });
        },
        async registerEmitters(emitters: EmitterToRegister[]): Promise<void> {
            // Aztec contract takes arrays of chainIds and emitter bytes
            await bridge.methods
                .register_emitter(
                    emitters.map(e => e.chainId) as any,
                    emitters.map(e => hexToBytes32Array(e.emitter)) as any
                )
                .send(opts.send)
                .wait(opts.wait);
        },
    };
}

async function createSolanaAdapter(): Promise<ChainAdapter> {
    const { client } = createSolanaClient(env.SOLANA_RPC_URL, env.SOLANA_BRIDGE_PROGRAM_ID);
    const owner = loadKeypair();

    const isInitialized = await client.isInitialized();
    if (!isInitialized) throw new Error("Solana program not initialized");

    return {
        async isEmitterRegistered(targetChainId: number, expectedEmitter: string): Promise<boolean> {
            const emitter = await client.getForeignEmitter(targetChainId);
            if (!emitter) return false;
            const expectedBytes = Buffer.from(expectedEmitter.replace("0x", ""), "hex");
            return Buffer.from(emitter.address).equals(expectedBytes);
        },
        async registerEmitters(emitters: EmitterToRegister[]): Promise<void> {
            await client.registerEmitters(
                owner,
                emitters.map(e => ({
                    chainId: e.chainId,
                    emitterAddress: new Uint8Array(Buffer.from(e.emitter.replace("0x", ""), "hex")),
                    isDefaultPayload: e.isDefaultPayload,
                }))
            );
        },
    };
}

async function main() {
    console.log("Configuring cross-chain bridges...\n");

    const adapters: Record<ChainId, ChainAdapter> = {
        arbitrum: await createEvmAdapter(env.ARBITRUM_RPC_URL, env.ARBITRUM_BRIDGE_ADDRESS, "arbitrum"),
        base: await createEvmAdapter(env.BASE_RPC_URL, env.BASE_BRIDGE_ADDRESS, "base"),
        aztec: await createAztecAdapter(),
        solana: await createSolanaAdapter(),
    };

    const chainIds = Object.keys(CHAINS) as ChainId[];
    let totalRegistered = 0;

    for (const checkerId of chainIds) {
        const checker = CHAINS[checkerId];
        const adapter = adapters[checkerId];

        console.log(`\n=== ${checker.name} ===`);

        const toRegister: EmitterToRegister[] = [];

        for (const targetId of chainIds) {
            if (checkerId === targetId) continue;

            const target = CHAINS[targetId];
            const expectedEmitter = target.getEmitterAddress();
            const registered = await adapter.isEmitterRegistered(target.wormholeChainId, expectedEmitter);

            if (registered) {
                console.log(`  ${target.name}: already registered`);
            } else {
                console.log(`  ${target.name}: needs registration`);
                toRegister.push({
                    chainId: target.wormholeChainId,
                    emitter: expectedEmitter,
                    isDefaultPayload: target.isDefaultPayload,
                });
            }
        }

        if (toRegister.length > 0) {
            console.log(`  Registering ${toRegister.length} emitter(s)...`);
            await adapter.registerEmitters(toRegister);
            totalRegistered += toRegister.length;
            console.log(`  Done!`);
        }
    }

    console.log("\n" + "─".repeat(40));
    if (totalRegistered > 0) {
        console.log(`Registered ${totalRegistered} emitter(s) across ${chainIds.length} chains.`);
    } else {
        console.log("All emitters already registered!");
    }
}

main().catch((err) => {
    console.error("Registration failed:", err);
    process.exit(1);
});
