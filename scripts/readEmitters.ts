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
import { createEvmClients, MESSAGE_BRIDGE_ABI } from "./utils/evm";
import { createSolanaClient, formatEmitterAddress } from "./utils/solana";
import { AZTEC_WORMHOLE_CHAIN_ID, ARBITRUM_SEPOLIA_CHAIN_ID } from "@aztec-wormhole-demo/aztec-contracts/constants";
import {
    CHAIN_ID_SOLANA,
    CHAIN_ID_ARBITRUM_SEPOLIA,
    CHAIN_ID_AZTEC,
    MessageBridgeClient,
} from "@aztec-wormhole-demo/solana-sdk";

const {
    AZTEC_NODE_URL,
    ARBITRUM_RPC_URL,
    EVM_PRIVATE_KEY,
    AZTEC_BRIDGE_ADDRESS,
    EVM_BRIDGE_ADDRESS,
    AZTEC_WORMHOLE_ADDRESS,
    EVM_WORMHOLE_ADDRESS,
    SOLANA_RPC_URL,
    SOLANA_BRIDGE_PROGRAM_ID,
} = process.env;

if (!AZTEC_NODE_URL) throw new Error("AZTEC_NODE_URL not set in .env");
if (!ARBITRUM_RPC_URL) throw new Error("ARBITRUM_RPC_URL not set in .env");
if (!EVM_PRIVATE_KEY) throw new Error("EVM_PRIVATE_KEY not set in .env");
if (!AZTEC_BRIDGE_ADDRESS) throw new Error("AZTEC_BRIDGE_ADDRESS not set in .env - deploy Aztec bridge first");
if (!EVM_BRIDGE_ADDRESS) throw new Error("EVM_BRIDGE_ADDRESS not set in .env - deploy EVM bridge first");
if (!AZTEC_WORMHOLE_ADDRESS) throw new Error("AZTEC_WORMHOLE_ADDRESS not set in .env");
if (!EVM_WORMHOLE_ADDRESS) throw new Error("EVM_WORMHOLE_ADDRESS not set in .env");

// Solana is optional for now
const SOLANA_ENABLED = SOLANA_RPC_URL && SOLANA_BRIDGE_PROGRAM_ID;

interface CheckResult {
    side: string;
    expectedEmitter: string;
    registeredEmitter: string;
    isRegistered: boolean;
    isEnabled?: boolean;
}

async function checkEvmBridge(): Promise<CheckResult[]> {
    console.log("\n=== Checking EVM MessageBridge ===");
    console.log(`EVM Bridge Address: ${EVM_BRIDGE_ADDRESS}`);

    const { publicClient } = createEvmClients(ARBITRUM_RPC_URL!, EVM_PRIVATE_KEY!);
    const evmBridgeAddress = getAddress(EVM_BRIDGE_ADDRESS!);
    const results: CheckResult[] = [];

    // Check Aztec emitter
    console.log(`\n  Checking Aztec emitter (chain ${AZTEC_WORMHOLE_CHAIN_ID})...`);
    const aztecExpected = addressToBytes32(AZTEC_WORMHOLE_ADDRESS!);
    const aztecRegistered = await publicClient.readContract({
        address: evmBridgeAddress,
        abi: MESSAGE_BRIDGE_ABI,
        functionName: "registeredEmitters",
        args: [AZTEC_WORMHOLE_CHAIN_ID],
    }) as `0x${string}`;

    const aztecMatch = aztecRegistered.toLowerCase() === aztecExpected.toLowerCase();
    console.log(`    Expected: ${aztecExpected}`);
    console.log(`    Registered: ${aztecRegistered}`);
    console.log(`    Status: ${aztecMatch ? "✅ REGISTERED" : "❌ NOT REGISTERED"}`);

    results.push({
        side: "EVM (Aztec emitter)",
        expectedEmitter: aztecExpected,
        registeredEmitter: aztecRegistered,
        isRegistered: aztecMatch,
    });

    // Check Solana emitter if enabled
    if (SOLANA_ENABLED) {
        console.log(`\n  Checking Solana emitter (chain ${CHAIN_ID_SOLANA})...`);
        const { client } = createSolanaClient(SOLANA_RPC_URL!, SOLANA_BRIDGE_PROGRAM_ID!);
        const solanaEmitter = client.getEmitterAddress();
        const solanaExpected = formatEmitterAddress(solanaEmitter);

        const solanaRegistered = await publicClient.readContract({
            address: evmBridgeAddress,
            abi: MESSAGE_BRIDGE_ABI,
            functionName: "registeredEmitters",
            args: [CHAIN_ID_SOLANA],
        }) as `0x${string}`;

        const solanaMatch = solanaRegistered.toLowerCase() === solanaExpected.toLowerCase();
        console.log(`    Expected: ${solanaExpected}`);
        console.log(`    Registered: ${solanaRegistered}`);
        console.log(`    Status: ${solanaMatch ? "✅ REGISTERED" : "❌ NOT REGISTERED"}`);

        results.push({
            side: "EVM (Solana emitter)",
            expectedEmitter: solanaExpected,
            registeredEmitter: solanaRegistered,
            isRegistered: solanaMatch,
        });
    }

    return results;
}

async function checkAztecBridge(): Promise<CheckResult[]> {
    console.log("\n=== Checking Aztec MessageBridge ===");
    console.log(`Aztec Bridge Address: ${AZTEC_BRIDGE_ADDRESS}`);

    const node = createAztecNodeClient(AZTEC_NODE_URL!);
    const wallet = await TestWallet.create(node, getTestnetPxeConfig());
    const adminAddress = await loadAccount(node, wallet);

    // Register the bridge contract
    const bridgeAddress = AztecAddress.fromString(AZTEC_BRIDGE_ADDRESS!);
    const instance = await node.getContract(bridgeAddress);
    if (!instance) throw new Error("Aztec bridge contract not found");
    await wallet.registerContract(instance, MessageBridgeContractArtifact);

    const bridge = await MessageBridgeContract.at(bridgeAddress, wallet);
    const results: CheckResult[] = [];

    // Check EVM emitter
    console.log(`\n  Checking EVM emitter (chain ${ARBITRUM_SEPOLIA_CHAIN_ID})...`);
    const evmExpected = addressToBytes32(EVM_BRIDGE_ADDRESS!);
    const evmEmitterBytes = hexToBytes32Array(EVM_BRIDGE_ADDRESS!);
    const evmRegistered = await bridge.methods
        .is_emitter_registered(ARBITRUM_SEPOLIA_CHAIN_ID, evmEmitterBytes as any)
        .simulate({ from: adminAddress });

    console.log(`    Expected: ${evmExpected}`);
    console.log(`    Status: ${evmRegistered ? "✅ REGISTERED" : "❌ NOT REGISTERED"}`);

    results.push({
        side: "Aztec (EVM emitter)",
        expectedEmitter: evmExpected,
        registeredEmitter: evmRegistered ? evmExpected : "0x" + "0".repeat(64),
        isRegistered: evmRegistered,
    });

    // Check Solana emitter if enabled
    if (SOLANA_ENABLED) {
        console.log(`\n  Checking Solana emitter (chain ${CHAIN_ID_SOLANA})...`);
        const { client } = createSolanaClient(SOLANA_RPC_URL!, SOLANA_BRIDGE_PROGRAM_ID!);
        const solanaEmitter = client.getEmitterAddress();
        const solanaExpected = formatEmitterAddress(solanaEmitter);
        const solanaEmitterBytes = hexToBytes32Array(solanaExpected);

        const solanaRegistered = await bridge.methods
            .is_emitter_registered(CHAIN_ID_SOLANA, solanaEmitterBytes as any)
            .simulate({ from: adminAddress });

        console.log(`    Expected: ${solanaExpected}`);
        console.log(`    Status: ${solanaRegistered ? "✅ REGISTERED" : "❌ NOT REGISTERED"}`);

        results.push({
            side: "Aztec (Solana emitter)",
            expectedEmitter: solanaExpected,
            registeredEmitter: solanaRegistered ? solanaExpected : "0x" + "0".repeat(64),
            isRegistered: solanaRegistered,
        });
    }

    return results;
}

async function checkSolanaBridge(): Promise<CheckResult[]> {
    if (!SOLANA_ENABLED) {
        console.log("\n=== Skipping Solana MessageBridge (not configured) ===");
        return [];
    }

    console.log("\n=== Checking Solana MessageBridge ===");
    console.log(`Solana Program ID: ${SOLANA_BRIDGE_PROGRAM_ID}`);

    const { client } = createSolanaClient(SOLANA_RPC_URL!, SOLANA_BRIDGE_PROGRAM_ID!);
    const results: CheckResult[] = [];

    // Check if initialized
    const isInitialized = await client.isInitialized();
    if (!isInitialized) {
        console.log("  ⚠️  Program not initialized yet");
        return [{
            side: "Solana",
            expectedEmitter: "N/A",
            registeredEmitter: "N/A",
            isRegistered: false,
        }];
    }

    // Check EVM emitter
    console.log(`\n  Checking EVM emitter (chain ${CHAIN_ID_ARBITRUM_SEPOLIA})...`);
    const evmExpected = MessageBridgeClient.evmAddressToWormhole(EVM_BRIDGE_ADDRESS!);
    const evmEmitter = await client.getForeignEmitter(CHAIN_ID_ARBITRUM_SEPOLIA);
    const evmRegistered = evmEmitter !== null &&
        Buffer.from(evmEmitter.address).equals(Buffer.from(evmExpected));

    console.log(`    Expected: ${formatEmitterAddress(evmExpected)}`);
    console.log(`    Registered: ${evmEmitter ? formatEmitterAddress(evmEmitter.address) : "None"}`);
    console.log(`    Status: ${evmRegistered ? "✅ REGISTERED" : "❌ NOT REGISTERED"}`);

    results.push({
        side: "Solana (EVM emitter)",
        expectedEmitter: formatEmitterAddress(evmExpected),
        registeredEmitter: evmEmitter ? formatEmitterAddress(evmEmitter.address) : "0x" + "0".repeat(64),
        isRegistered: evmRegistered,
    });

    // Check Aztec emitter
    console.log(`\n  Checking Aztec emitter (chain ${CHAIN_ID_AZTEC})...`);
    const aztecExpected = MessageBridgeClient.aztecAddressToWormhole(AZTEC_WORMHOLE_ADDRESS!);
    const aztecEmitter = await client.getForeignEmitter(CHAIN_ID_AZTEC);
    const aztecRegistered = aztecEmitter !== null &&
        Buffer.from(aztecEmitter.address).equals(Buffer.from(aztecExpected));

    console.log(`    Expected: ${formatEmitterAddress(aztecExpected)}`);
    console.log(`    Registered: ${aztecEmitter ? formatEmitterAddress(aztecEmitter.address) : "None"}`);
    console.log(`    Status: ${aztecRegistered ? "✅ REGISTERED" : "❌ NOT REGISTERED"}`);

    results.push({
        side: "Solana (Aztec emitter)",
        expectedEmitter: formatEmitterAddress(aztecExpected),
        registeredEmitter: aztecEmitter ? formatEmitterAddress(aztecEmitter.address) : "0x" + "0".repeat(64),
        isRegistered: aztecRegistered,
    });

    return results;
}

async function main() {
    console.log("Checking cross-chain bridge emitter registrations...");
    console.log(`\nAddresses from .env:`);
    console.log(`  Aztec Bridge: ${AZTEC_BRIDGE_ADDRESS}`);
    console.log(`  EVM Bridge: ${EVM_BRIDGE_ADDRESS}`);
    console.log(`  Aztec Wormhole (emitter for Aztec->EVM): ${AZTEC_WORMHOLE_ADDRESS}`);
    if (SOLANA_ENABLED) {
        console.log(`  Solana Program: ${SOLANA_BRIDGE_PROGRAM_ID}`);
    }

    const results: CheckResult[] = [];

    // Check EVM side
    results.push(...await checkEvmBridge());

    // Check Aztec side
    results.push(...await checkAztecBridge());

    // Check Solana side
    results.push(...await checkSolanaBridge());

    // Summary
    console.log("\n=== Summary ===");
    const allGood = results.every(r => r.isRegistered);

    if (allGood) {
        console.log("✅ All emitters are correctly registered!");
        if (SOLANA_ENABLED) {
            console.log("   All three bridges trust each other for cross-chain messaging.");
        } else {
            console.log("   Both bridges trust each other for cross-chain messaging.");
        }
    } else {
        console.log("❌ Some emitters are not correctly registered:");
        for (const result of results) {
            if (!result.isRegistered) {
                console.log(`   - ${result.side}:`);
                console.log(`       Expected: ${result.expectedEmitter}`);
                console.log(`       Got: ${result.registeredEmitter}`);
            }
        }
        console.log("\nRun 'pnpm run configure:aztec' to register the emitters.");
        process.exit(1);
    }
}

main().catch((err) => {
    console.error("Check failed:", err);
    process.exit(1);
});
