#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();

import { getAddress } from "viem";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { TestWallet } from "@aztec/test-wallet/server";
import { MessageBridgeContract, MessageBridgeContractArtifact } from "@aztec-wormhole-demo/aztec-contracts/artifacts";
import { loadAccount, getTestnetPxeConfig } from "./utils/aztec";
import { addressToBytes32, hexToBytes32Array } from "./utils/bytes";
import { createEvmClients, MESSAGE_BRIDGE_ABI, EvmChainName } from "./utils/evm";
import { createSolanaClient, formatEmitterAddress } from "./utils/solana";
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

// Validate all required env vars
for (const [key, value] of Object.entries(env)) {
    if (!value) throw new Error(`${key} not set in .env`);
}

// Chain definitions
type ChainId = "arbitrum" | "base" | "aztec" | "solana";

interface Chain {
    name: string;
    wormholeChainId: number;
    getEmitterAddress: () => string;
}

const CHAINS: Record<ChainId, Chain> = {
    arbitrum: {
        name: "Arbitrum",
        wormholeChainId: WORMHOLE_CHAIN_ID_ARBITRUM_SEPOLIA,
        getEmitterAddress: () => addressToBytes32(env.ARBITRUM_BRIDGE_ADDRESS),
    },
    base: {
        name: "Base",
        wormholeChainId: WORMHOLE_CHAIN_ID_BASE_SEPOLIA,
        getEmitterAddress: () => addressToBytes32(env.BASE_BRIDGE_ADDRESS),
    },
    aztec: {
        name: "Aztec",
        wormholeChainId: WORMHOLE_CHAIN_ID_AZTEC,
        getEmitterAddress: () => addressToBytes32(env.AZTEC_WORMHOLE_ADDRESS),
    },
    solana: {
        name: "Solana",
        wormholeChainId: WORMHOLE_CHAIN_ID_SOLANA,
        getEmitterAddress: () => {
            const { client } = createSolanaClient(env.SOLANA_RPC_URL, env.SOLANA_BRIDGE_PROGRAM_ID);
            return formatEmitterAddress(client.getEmitterAddress());
        },
    },
};

// Chain adapters - each knows how to check if an emitter is registered
interface ChainAdapter {
    isEmitterRegistered(targetChainId: number, expectedEmitter: string): Promise<boolean>;
}

async function createEvmAdapter(rpcUrl: string, bridgeAddress: string, chainName: EvmChainName): Promise<ChainAdapter> {
    const { publicClient } = createEvmClients(rpcUrl, env.EVM_PRIVATE_KEY, chainName);
    const address = getAddress(bridgeAddress);

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

    return {
        async isEmitterRegistered(targetChainId: number, expectedEmitter: string): Promise<boolean> {
            const emitterBytes = hexToBytes32Array(expectedEmitter);
            return bridge.methods
                .is_emitter_registered(targetChainId, emitterBytes as any)
                .simulate({ from: adminAddress });
        },
    };
}

async function createSolanaAdapter(): Promise<ChainAdapter> {
    const { client } = createSolanaClient(env.SOLANA_RPC_URL, env.SOLANA_BRIDGE_PROGRAM_ID);

    const isInitialized = await client.isInitialized();
    if (!isInitialized) throw new Error("Solana program not initialized");

    return {
        async isEmitterRegistered(targetChainId: number, expectedEmitter: string): Promise<boolean> {
            const emitter = await client.getForeignEmitter(targetChainId);
            if (!emitter) return false;

            // Convert expected emitter to compare
            const expectedBytes = Buffer.from(expectedEmitter.replace("0x", ""), "hex");
            return Buffer.from(emitter.address).equals(expectedBytes);
        },
    };
}

interface CheckResult {
    checker: string;
    target: string;
    registered: boolean;
}

async function main() {
    console.log("Checking cross-chain bridge emitter registrations...\n");

    // Create all adapters
    const adapters: Record<ChainId, ChainAdapter> = {
        arbitrum: await createEvmAdapter(env.ARBITRUM_RPC_URL, env.ARBITRUM_BRIDGE_ADDRESS, "arbitrum"),
        base: await createEvmAdapter(env.BASE_RPC_URL, env.BASE_BRIDGE_ADDRESS, "base"),
        aztec: await createAztecAdapter(),
        solana: await createSolanaAdapter(),
    };

    const results: CheckResult[] = [];
    const chainIds = Object.keys(CHAINS) as ChainId[];

    // For each chain, check all other chains' emitters
    for (const checkerId of chainIds) {
        const checker = CHAINS[checkerId];
        const adapter = adapters[checkerId];

        for (const targetId of chainIds) {
            if (checkerId === targetId) continue;

            const target = CHAINS[targetId];
            const expectedEmitter = target.getEmitterAddress();

            const registered = await adapter.isEmitterRegistered(target.wormholeChainId, expectedEmitter);
            results.push({
                checker: checker.name,
                target: target.name,
                registered,
            });
        }
    }

    // Print results table
    console.log("Registration Matrix:");
    console.log("─".repeat(50));
    console.log(`${"Checker".padEnd(12)} ${"Target".padEnd(12)} ${"Status".padEnd(15)}`);
    console.log("─".repeat(50));

    for (const r of results) {
        const status = r.registered ? "✓ REGISTERED" : "✗ MISSING";
        console.log(`${r.checker.padEnd(12)} ${r.target.padEnd(12)} ${status}`);
    }
    console.log("─".repeat(50));

    // Summary
    const missing = results.filter(r => !r.registered);
    if (missing.length === 0) {
        console.log("\n✓ All emitters correctly registered!");
    } else {
        console.log(`\n✗ ${missing.length} emitter(s) not registered`);
        console.log("Run 'pnpm register-emitters' to fix.");
        process.exit(1);
    }
}

main().catch((err) => {
    console.error("Check failed:", err);
    process.exit(1);
});
