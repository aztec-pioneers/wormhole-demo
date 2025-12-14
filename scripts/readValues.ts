#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { TestWallet } from "@aztec/test-wallet/server";
import { MessageBridgeContract, MessageBridgeContractArtifact } from "@aztec-wormhole-demo/aztec-contracts/artifacts";
import { loadAccount, getTestnetPxeConfig } from "./utils/aztec";
import { createEvmClients, MESSAGE_BRIDGE_ABI, EvmChainName } from "./utils/evm";
import { createSolanaClient } from "./utils/solana";
import { getAddress } from "viem";

const {
    AZTEC_NODE_URL,
    AZTEC_BRIDGE_ADDRESS,
    ARBITRUM_RPC_URL,
    EVM_PRIVATE_KEY,
    ARBITRUM_BRIDGE_ADDRESS,
    BASE_RPC_URL,
    BASE_BRIDGE_ADDRESS,
    SOLANA_RPC_URL,
    SOLANA_BRIDGE_PROGRAM_ID,
} = process.env;

const SOLANA_ENABLED = SOLANA_RPC_URL && SOLANA_BRIDGE_PROGRAM_ID;

async function readEvmBridge(chainName: EvmChainName, rpcUrl: string | undefined, bridgeAddress: string | undefined, displayName: string) {
    if (!rpcUrl || !bridgeAddress) {
        console.log(`\n=== ${displayName} ===`);
        console.log(`  Not configured (missing RPC URL or bridge address)`);
        return;
    }

    try {
        const { publicClient } = createEvmClients(rpcUrl, EVM_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000001", chainName);
        const address = getAddress(bridgeAddress);

        const currentValue = await publicClient.readContract({
            address,
            abi: MESSAGE_BRIDGE_ABI,
            functionName: "currentValue",
        }) as number;

        console.log(`\n=== ${displayName} ===`);
        console.log(`  Contract: ${address}`);
        console.log(`  Current value: ${currentValue}`);
    } catch (err) {
        console.log(`\n=== ${displayName} ===`);
        console.log(`  Error reading: ${err}`);
    }
}

async function readArbitrumBridge() {
    await readEvmBridge("arbitrum", ARBITRUM_RPC_URL, ARBITRUM_BRIDGE_ADDRESS, "Arbitrum Bridge (Sepolia)");
}

async function readBaseBridge() {
    await readEvmBridge("base", BASE_RPC_URL, BASE_BRIDGE_ADDRESS, "Base Bridge (Sepolia)");
}

async function readAztecBridge() {
    if (!AZTEC_NODE_URL || !AZTEC_BRIDGE_ADDRESS) {
        console.log("\n=== Aztec Bridge ===");
        console.log("  Not configured (missing AZTEC_NODE_URL or AZTEC_BRIDGE_ADDRESS)");
        return;
    }

    try {
        const node = createAztecNodeClient(AZTEC_NODE_URL);
        const wallet = await TestWallet.create(node, getTestnetPxeConfig());
        const adminAddress = await loadAccount(node, wallet);

        const bridgeAddress = AztecAddress.fromString(AZTEC_BRIDGE_ADDRESS);
        const instance = await node.getContract(bridgeAddress);
        if (!instance) {
            console.log("\n=== Aztec Bridge ===");
            console.log("  Contract not found");
            return;
        }
        await wallet.registerContract(instance, MessageBridgeContractArtifact);

        const bridge = await MessageBridgeContract.at(bridgeAddress, wallet);

        const currentValue = await bridge.methods.get_current_value().simulate({ from: adminAddress });

        console.log("\n=== Aztec Bridge ===");
        console.log(`  Contract: ${AZTEC_BRIDGE_ADDRESS}`);
        console.log(`  Current value: ${currentValue}`);
    } catch (err) {
        console.log("\n=== Aztec Bridge ===");
        console.log(`  Error reading: ${err}`);
    }
}

async function readSolanaBridge() {
    if (!SOLANA_ENABLED) {
        console.log("\n=== Solana Bridge ===");
        console.log("  Not configured (missing SOLANA_RPC_URL or SOLANA_BRIDGE_PROGRAM_ID)");
        return;
    }

    try {
        const { client } = createSolanaClient(SOLANA_RPC_URL!, SOLANA_BRIDGE_PROGRAM_ID!);

        // Check if initialized
        const isInitialized = await client.isInitialized();
        if (!isInitialized) {
            console.log("\n=== Solana Bridge (Devnet) ===");
            console.log(`  Program: ${SOLANA_BRIDGE_PROGRAM_ID}`);
            console.log("  Status: Not initialized");
            return;
        }

        const currentValue = await client.getCurrentValue();

        console.log("\n=== Solana Bridge (Devnet) ===");
        console.log(`  Program: ${SOLANA_BRIDGE_PROGRAM_ID}`);
        console.log(`  Current value: ${currentValue !== null ? currentValue.value.toString() : "Not set"}`);
    } catch (err) {
        console.log("\n=== Solana Bridge (Devnet) ===");
        console.log(`  Error reading: ${err}`);
    }
}

async function main() {
    console.log("Reading bridge state from all chains...");

    await Promise.all([
        readArbitrumBridge(),
        readBaseBridge(),
        readAztecBridge(),
        readSolanaBridge(),
    ]);

    console.log("");
}

main().catch(console.error);
