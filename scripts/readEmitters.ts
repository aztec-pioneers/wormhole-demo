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
    WORMHOLE_WORMHOLE_CHAIN_ID_SOLANA,
    WORMHOLE_WORMHOLE_CHAIN_ID_ARBITRUM_SEPOLIA,
    WORMHOLE_WORMHOLE_CHAIN_ID_BASE_SEPOLIA,
    WORMHOLE_WORMHOLE_CHAIN_ID_AZTEC,
    MessageBridgeClient,
} from "@aztec-wormhole-demo/solana-sdk";

const {
    AZTEC_NODE_URL,
    ARBITRUM_RPC_URL,
    BASE_RPC_URL,
    EVM_PRIVATE_KEY,
    AZTEC_BRIDGE_ADDRESS,
    ARBITRUM_BRIDGE_ADDRESS,
    BASE_BRIDGE_ADDRESS,
    AZTEC_WORMHOLE_ADDRESS,
    BASE_WORMHOLE_ADDRESS,
    SOLANA_RPC_URL,
    SOLANA_BRIDGE_PROGRAM_ID,
} = process.env;

if (!AZTEC_NODE_URL) throw new Error("AZTEC_NODE_URL not set in .env");
if (!ARBITRUM_RPC_URL) throw new Error("ARBITRUM_RPC_URL not set in .env");
if (!EVM_PRIVATE_KEY) throw new Error("EVM_PRIVATE_KEY not set in .env");
if (!AZTEC_BRIDGE_ADDRESS) throw new Error("AZTEC_BRIDGE_ADDRESS not set in .env - deploy Aztec bridge first");
if (!ARBITRUM_BRIDGE_ADDRESS) throw new Error("ARBITRUM_BRIDGE_ADDRESS not set in .env - deploy EVM bridge first");
if (!AZTEC_WORMHOLE_ADDRESS) throw new Error("AZTEC_WORMHOLE_ADDRESS not set in .env");

// Solana is optional
const SOLANA_ENABLED = SOLANA_RPC_URL && SOLANA_BRIDGE_PROGRAM_ID;
// Base is optional (may not be deployed yet)
const BASE_ENABLED = BASE_RPC_URL && BASE_BRIDGE_ADDRESS && BASE_WORMHOLE_ADDRESS;

interface CheckResult {
    side: string;
    expectedEmitter: string;
    registeredEmitter: string;
    isRegistered: boolean;
}

async function checkEvmBridge(
    chainName: EvmChainName,
    rpcUrl: string,
    bridgeAddress: string,
    displayName: string,
    wormholeChainId: number
): Promise<CheckResult[]> {
    console.log(`\n=== Checking ${displayName} ===`);
    console.log(`Bridge Address: ${bridgeAddress}`);

    const { publicClient } = createEvmClients(rpcUrl, EVM_PRIVATE_KEY!, chainName);
    const evmBridgeAddress = getAddress(bridgeAddress);
    const results: CheckResult[] = [];

    // Check Aztec emitter
    console.log(`\n  Checking Aztec emitter (chain ${WORMHOLE_WORMHOLE_CHAIN_ID_AZTEC})...`);
    const aztecExpected = addressToBytes32(AZTEC_WORMHOLE_ADDRESS!);
    const aztecRegistered = await publicClient.readContract({
        address: evmBridgeAddress,
        abi: MESSAGE_BRIDGE_ABI,
        functionName: "registeredEmitters",
        args: [WORMHOLE_WORMHOLE_CHAIN_ID_AZTEC],
    }) as `0x${string}`;

    const aztecMatch = aztecRegistered.toLowerCase() === aztecExpected.toLowerCase();
    console.log(`    Expected: ${aztecExpected}`);
    console.log(`    Registered: ${aztecRegistered}`);
    console.log(`    Status: ${aztecMatch ? "REGISTERED" : "NOT REGISTERED"}`);

    results.push({
        side: `${displayName} (Aztec emitter)`,
        expectedEmitter: aztecExpected,
        registeredEmitter: aztecRegistered,
        isRegistered: aztecMatch,
    });

    // Check Solana emitter if enabled
    if (SOLANA_ENABLED) {
        console.log(`\n  Checking Solana emitter (chain ${WORMHOLE_CHAIN_ID_SOLANA})...`);
        const { client } = createSolanaClient(SOLANA_RPC_URL!, SOLANA_BRIDGE_PROGRAM_ID!);
        const solanaEmitter = client.getEmitterAddress();
        const solanaExpected = formatEmitterAddress(solanaEmitter);

        const solanaRegistered = await publicClient.readContract({
            address: evmBridgeAddress,
            abi: MESSAGE_BRIDGE_ABI,
            functionName: "registeredEmitters",
            args: [WORMHOLE_CHAIN_ID_SOLANA],
        }) as `0x${string}`;

        const solanaMatch = solanaRegistered.toLowerCase() === solanaExpected.toLowerCase();
        console.log(`    Expected: ${solanaExpected}`);
        console.log(`    Registered: ${solanaRegistered}`);
        console.log(`    Status: ${solanaMatch ? "REGISTERED" : "NOT REGISTERED"}`);

        results.push({
            side: `${displayName} (Solana emitter)`,
            expectedEmitter: solanaExpected,
            registeredEmitter: solanaRegistered,
            isRegistered: solanaMatch,
        });
    }

    // Check other EVM chain emitter
    if (chainName === "arbitrum" && BASE_ENABLED) {
        console.log(`\n  Checking Base emitter (chain ${WORMHOLE_WORMHOLE_CHAIN_ID_BASE_SEPOLIA})...`);
        const baseExpected = addressToBytes32(BASE_BRIDGE_ADDRESS!);
        const baseRegistered = await publicClient.readContract({
            address: evmBridgeAddress,
            abi: MESSAGE_BRIDGE_ABI,
            functionName: "registeredEmitters",
            args: [WORMHOLE_WORMHOLE_CHAIN_ID_BASE_SEPOLIA],
        }) as `0x${string}`;

        const baseMatch = baseRegistered.toLowerCase() === baseExpected.toLowerCase();
        console.log(`    Expected: ${baseExpected}`);
        console.log(`    Registered: ${baseRegistered}`);
        console.log(`    Status: ${baseMatch ? "REGISTERED" : "NOT REGISTERED"}`);

        results.push({
            side: `${displayName} (Base emitter)`,
            expectedEmitter: baseExpected,
            registeredEmitter: baseRegistered,
            isRegistered: baseMatch,
        });
    } else if (chainName === "base") {
        console.log(`\n  Checking Arbitrum emitter (chain ${WORMHOLE_WORMHOLE_CHAIN_ID_ARBITRUM_SEPOLIA})...`);
        const arbExpected = addressToBytes32(ARBITRUM_BRIDGE_ADDRESS!);
        const arbRegistered = await publicClient.readContract({
            address: evmBridgeAddress,
            abi: MESSAGE_BRIDGE_ABI,
            functionName: "registeredEmitters",
            args: [WORMHOLE_WORMHOLE_CHAIN_ID_ARBITRUM_SEPOLIA],
        }) as `0x${string}`;

        const arbMatch = arbRegistered.toLowerCase() === arbExpected.toLowerCase();
        console.log(`    Expected: ${arbExpected}`);
        console.log(`    Registered: ${arbRegistered}`);
        console.log(`    Status: ${arbMatch ? "REGISTERED" : "NOT REGISTERED"}`);

        results.push({
            side: `${displayName} (Arbitrum emitter)`,
            expectedEmitter: arbExpected,
            registeredEmitter: arbRegistered,
            isRegistered: arbMatch,
        });
    }

    return results;
}

async function checkArbitrumBridge(): Promise<CheckResult[]> {
    return checkEvmBridge("arbitrum", ARBITRUM_RPC_URL!, ARBITRUM_BRIDGE_ADDRESS!, "Arbitrum MessageBridge", WORMHOLE_WORMHOLE_CHAIN_ID_ARBITRUM_SEPOLIA);
}

async function checkBaseBridge(): Promise<CheckResult[]> {
    if (!BASE_ENABLED) {
        console.log("\n=== Skipping Base MessageBridge (not configured) ===");
        return [];
    }
    return checkEvmBridge("base", BASE_RPC_URL!, BASE_BRIDGE_ADDRESS!, "Base MessageBridge", WORMHOLE_WORMHOLE_CHAIN_ID_BASE_SEPOLIA);
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

    // Check Arbitrum emitter
    console.log(`\n  Checking Arbitrum emitter (chain ${WORMHOLE_WORMHOLE_CHAIN_ID_ARBITRUM_SEPOLIA})...`);
    const arbExpected = addressToBytes32(ARBITRUM_BRIDGE_ADDRESS!);
    const arbEmitterBytes = hexToBytes32Array(ARBITRUM_BRIDGE_ADDRESS!);
    const arbRegistered = await bridge.methods
        .is_emitter_registered(WORMHOLE_WORMHOLE_CHAIN_ID_ARBITRUM_SEPOLIA, arbEmitterBytes as any)
        .simulate({ from: adminAddress });

    console.log(`    Expected: ${arbExpected}`);
    console.log(`    Status: ${arbRegistered ? "REGISTERED" : "NOT REGISTERED"}`);

    results.push({
        side: "Aztec (Arbitrum emitter)",
        expectedEmitter: arbExpected,
        registeredEmitter: arbRegistered ? arbExpected : "0x" + "0".repeat(64),
        isRegistered: arbRegistered,
    });

    // Check Base emitter if enabled
    if (BASE_ENABLED) {
        console.log(`\n  Checking Base emitter (chain ${WORMHOLE_WORMHOLE_CHAIN_ID_BASE_SEPOLIA})...`);
        const baseExpected = addressToBytes32(BASE_BRIDGE_ADDRESS!);
        const baseEmitterBytes = hexToBytes32Array(BASE_BRIDGE_ADDRESS!);
        const baseRegistered = await bridge.methods
            .is_emitter_registered(WORMHOLE_WORMHOLE_CHAIN_ID_BASE_SEPOLIA, baseEmitterBytes as any)
            .simulate({ from: adminAddress });

        console.log(`    Expected: ${baseExpected}`);
        console.log(`    Status: ${baseRegistered ? "REGISTERED" : "NOT REGISTERED"}`);

        results.push({
            side: "Aztec (Base emitter)",
            expectedEmitter: baseExpected,
            registeredEmitter: baseRegistered ? baseExpected : "0x" + "0".repeat(64),
            isRegistered: baseRegistered,
        });
    }

    // Check Solana emitter if enabled
    if (SOLANA_ENABLED) {
        console.log(`\n  Checking Solana emitter (chain ${WORMHOLE_CHAIN_ID_SOLANA})...`);
        const { client } = createSolanaClient(SOLANA_RPC_URL!, SOLANA_BRIDGE_PROGRAM_ID!);
        const solanaEmitter = client.getEmitterAddress();
        const solanaExpected = formatEmitterAddress(solanaEmitter);
        const solanaEmitterBytes = hexToBytes32Array(solanaExpected);

        const solanaRegistered = await bridge.methods
            .is_emitter_registered(WORMHOLE_CHAIN_ID_SOLANA, solanaEmitterBytes as any)
            .simulate({ from: adminAddress });

        console.log(`    Expected: ${solanaExpected}`);
        console.log(`    Status: ${solanaRegistered ? "REGISTERED" : "NOT REGISTERED"}`);

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
        console.log("  Program not initialized yet");
        return [{
            side: "Solana",
            expectedEmitter: "N/A",
            registeredEmitter: "N/A",
            isRegistered: false,
        }];
    }

    // Check Arbitrum emitter
    console.log(`\n  Checking Arbitrum emitter (chain ${WORMHOLE_CHAIN_ID_ARBITRUM_SEPOLIA})...`);
    const arbExpected = MessageBridgeClient.evmAddressToWormhole(ARBITRUM_BRIDGE_ADDRESS!);
    const arbEmitter = await client.getForeignEmitter(WORMHOLE_CHAIN_ID_ARBITRUM_SEPOLIA);
    const arbRegistered = arbEmitter !== null &&
        Buffer.from(arbEmitter.address).equals(Buffer.from(arbExpected));

    console.log(`    Expected: ${formatEmitterAddress(arbExpected)}`);
    console.log(`    Registered: ${arbEmitter ? formatEmitterAddress(arbEmitter.address) : "None"}`);
    console.log(`    Status: ${arbRegistered ? "REGISTERED" : "NOT REGISTERED"}`);

    results.push({
        side: "Solana (Arbitrum emitter)",
        expectedEmitter: formatEmitterAddress(arbExpected),
        registeredEmitter: arbEmitter ? formatEmitterAddress(arbEmitter.address) : "0x" + "0".repeat(64),
        isRegistered: arbRegistered,
    });

    // Check Base emitter if enabled
    if (BASE_ENABLED) {
        console.log(`\n  Checking Base emitter (chain ${WORMHOLE_CHAIN_ID_BASE_SEPOLIA})...`);
        const baseExpected = MessageBridgeClient.evmAddressToWormhole(BASE_BRIDGE_ADDRESS!);
        const baseEmitter = await client.getForeignEmitter(WORMHOLE_CHAIN_ID_BASE_SEPOLIA);
        const baseRegistered = baseEmitter !== null &&
            Buffer.from(baseEmitter.address).equals(Buffer.from(baseExpected));

        console.log(`    Expected: ${formatEmitterAddress(baseExpected)}`);
        console.log(`    Registered: ${baseEmitter ? formatEmitterAddress(baseEmitter.address) : "None"}`);
        console.log(`    Status: ${baseRegistered ? "REGISTERED" : "NOT REGISTERED"}`);

        results.push({
            side: "Solana (Base emitter)",
            expectedEmitter: formatEmitterAddress(baseExpected),
            registeredEmitter: baseEmitter ? formatEmitterAddress(baseEmitter.address) : "0x" + "0".repeat(64),
            isRegistered: baseRegistered,
        });
    }

    // Check Aztec emitter
    console.log(`\n  Checking Aztec emitter (chain ${WORMHOLE_CHAIN_ID_AZTEC})...`);
    const aztecExpected = MessageBridgeClient.aztecAddressToWormhole(AZTEC_WORMHOLE_ADDRESS!);
    const aztecEmitter = await client.getForeignEmitter(WORMHOLE_CHAIN_ID_AZTEC);
    const aztecRegistered = aztecEmitter !== null &&
        Buffer.from(aztecEmitter.address).equals(Buffer.from(aztecExpected));

    console.log(`    Expected: ${formatEmitterAddress(aztecExpected)}`);
    console.log(`    Registered: ${aztecEmitter ? formatEmitterAddress(aztecEmitter.address) : "None"}`);
    console.log(`    Status: ${aztecRegistered ? "REGISTERED" : "NOT REGISTERED"}`);

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
    console.log(`  Arbitrum Bridge: ${ARBITRUM_BRIDGE_ADDRESS}`);
    if (BASE_ENABLED) {
        console.log(`  Base Bridge: ${BASE_BRIDGE_ADDRESS}`);
    }
    console.log(`  Aztec Wormhole (emitter for Aztec->EVM): ${AZTEC_WORMHOLE_ADDRESS}`);
    if (SOLANA_ENABLED) {
        console.log(`  Solana Program: ${SOLANA_BRIDGE_PROGRAM_ID}`);
    }

    const results: CheckResult[] = [];

    // Check Arbitrum side
    results.push(...await checkArbitrumBridge());

    // Check Base side
    results.push(...await checkBaseBridge());

    // Check Aztec side
    results.push(...await checkAztecBridge());

    // Check Solana side
    results.push(...await checkSolanaBridge());

    // Summary
    console.log("\n=== Summary ===");
    const allGood = results.every(r => r.isRegistered);

    const chainCount = [true, BASE_ENABLED, SOLANA_ENABLED].filter(Boolean).length + 1; // +1 for Aztec

    if (allGood) {
        console.log(`All emitters are correctly registered!`);
        console.log(`   All ${chainCount} bridges trust each other for cross-chain messaging.`);
    } else {
        console.log("Some emitters are not correctly registered:");
        for (const result of results) {
            if (!result.isRegistered) {
                console.log(`   - ${result.side}:`);
                console.log(`       Expected: ${result.expectedEmitter}`);
                console.log(`       Got: ${result.registeredEmitter}`);
            }
        }
        console.log("\nRun 'pnpm run register-emitters' to register the emitters.");
        process.exit(1);
    }
}

main().catch((err) => {
    console.error("Check failed:", err);
    process.exit(1);
});
