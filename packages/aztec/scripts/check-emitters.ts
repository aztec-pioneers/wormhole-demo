#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();

import { getAddress } from "viem";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { TestWallet } from "@aztec/test-wallet/server";
import { MessageBridgeContract, MessageBridgeContractArtifact } from "../ts/artifacts";
import { loadAccount, getTestnetPxeConfig } from "./utils/aztec";
import { addressToBytes32, hexToBytes32Array } from "./utils/bytes";
import { createEvmClients, MESSAGE_BRIDGE_ABI } from "./utils/evm";
import { AZTEC_WORMHOLE_CHAIN_ID, ARBITRUM_SEPOLIA_CHAIN_ID } from "../ts/constants";

const {
    AZTEC_NODE_URL,
    ARBITRUM_RPC_URL,
    EVM_PRIVATE_KEY,
    AZTEC_BRIDGE_ADDRESS,
    EVM_BRIDGE_ADDRESS,
    AZTEC_WORMHOLE_ADDRESS,
    EVM_WORMHOLE_ADDRESS,
} = process.env;

if (!AZTEC_NODE_URL) throw new Error("AZTEC_NODE_URL not set in .env");
if (!ARBITRUM_RPC_URL) throw new Error("ARBITRUM_RPC_URL not set in .env");
if (!EVM_PRIVATE_KEY) throw new Error("EVM_PRIVATE_KEY not set in .env");
if (!AZTEC_BRIDGE_ADDRESS) throw new Error("AZTEC_BRIDGE_ADDRESS not set in .env - deploy Aztec bridge first");
if (!EVM_BRIDGE_ADDRESS) throw new Error("EVM_BRIDGE_ADDRESS not set in .env - deploy EVM bridge first");
if (!AZTEC_WORMHOLE_ADDRESS) throw new Error("AZTEC_WORMHOLE_ADDRESS not set in .env");
if (!EVM_WORMHOLE_ADDRESS) throw new Error("EVM_WORMHOLE_ADDRESS not set in .env");

interface CheckResult {
    side: string;
    expectedEmitter: string;
    registeredEmitter: string;
    isRegistered: boolean;
    isEnabled?: boolean;
}

async function checkEvmBridge(): Promise<CheckResult> {
    console.log("\n=== Checking EVM MessageBridge ===");
    console.log(`EVM Bridge Address: ${EVM_BRIDGE_ADDRESS}`);
    console.log(`Looking for Aztec Wormhole emitter (chain ${AZTEC_WORMHOLE_CHAIN_ID})`);

    const { publicClient } = createEvmClients(ARBITRUM_RPC_URL!, EVM_PRIVATE_KEY!);
    const evmBridgeAddress = getAddress(EVM_BRIDGE_ADDRESS!);

    // The emitter should be the Aztec Wormhole contract, not the bridge
    const expectedEmitter = addressToBytes32(AZTEC_WORMHOLE_ADDRESS!);

    // New: nested mapping (chainId => emitterAddress => bool)
    const isRegistered = await publicClient.readContract({
        address: evmBridgeAddress,
        abi: MESSAGE_BRIDGE_ABI,
        functionName: "registeredEmitters",
        args: [AZTEC_WORMHOLE_CHAIN_ID, expectedEmitter],
    }) as boolean;

    console.log(`  Expected: ${expectedEmitter}`);
    console.log(`  Registered: ${isRegistered}`);
    console.log(`  Status: ${isRegistered ? "✅ REGISTERED" : "❌ NOT REGISTERED"}`);

    return {
        side: "EVM",
        expectedEmitter,
        registeredEmitter: isRegistered ? expectedEmitter : "0x0000000000000000000000000000000000000000000000000000000000000000",
        isRegistered,
    };
}

async function checkAztecBridge(): Promise<CheckResult> {
    console.log("\n=== Checking Aztec MessageBridge ===");
    console.log(`Aztec Bridge Address: ${AZTEC_BRIDGE_ADDRESS}`);
    console.log(`Looking for EVM Bridge emitter (chain ${ARBITRUM_SEPOLIA_CHAIN_ID})`);

    const node = createAztecNodeClient(AZTEC_NODE_URL!);
    const wallet = await TestWallet.create(node, getTestnetPxeConfig());
    const adminAddress = await loadAccount(node, wallet);

    // Register the bridge contract
    const bridgeAddress = AztecAddress.fromString(AZTEC_BRIDGE_ADDRESS!);
    const instance = await node.getContract(bridgeAddress);
    if (!instance) throw new Error("Aztec bridge contract not found");
    await wallet.registerContract(instance, MessageBridgeContractArtifact);

    const bridge = await MessageBridgeContract.at(bridgeAddress, wallet);

    // The emitter is the EVM Bridge (the contract that calls wormhole.publishMessage)
    const expectedEmitter = addressToBytes32(EVM_BRIDGE_ADDRESS!);
    const evmEmitterBytes = hexToBytes32Array(EVM_BRIDGE_ADDRESS!);

    // New API: is_emitter_registered(chain_id, emitter_address) -> bool
    const isRegistered = await bridge.methods
        .is_emitter_registered(ARBITRUM_SEPOLIA_CHAIN_ID, evmEmitterBytes as any)
        .simulate({ from: adminAddress });

    console.log(`  Expected: ${expectedEmitter}`);
    console.log(`  Registered: ${isRegistered}`);
    console.log(`  Status: ${isRegistered ? "✅ REGISTERED" : "❌ NOT REGISTERED"}`);

    return {
        side: "Aztec",
        expectedEmitter,
        registeredEmitter: isRegistered ? expectedEmitter : "0x0000000000000000000000000000000000000000000000000000000000000000",
        isRegistered,
    };
}

async function main() {
    console.log("Checking cross-chain bridge emitter registrations...");
    console.log(`\nAddresses from .env:`);
    console.log(`  Aztec Bridge: ${AZTEC_BRIDGE_ADDRESS}`);
    console.log(`  EVM Bridge: ${EVM_BRIDGE_ADDRESS}`);
    console.log(`  Aztec Wormhole (emitter for Aztec->EVM): ${AZTEC_WORMHOLE_ADDRESS}`);
    console.log(`  EVM Bridge (emitter for EVM->Aztec): ${EVM_BRIDGE_ADDRESS}`);

    const results: CheckResult[] = [];

    // Check EVM side (should have Aztec bridge registered)
    results.push(await checkEvmBridge());

    // Check Aztec side (should have EVM bridge registered)
    results.push(await checkAztecBridge());

    // Summary
    console.log("\n=== Summary ===");
    const allGood = results.every(r => r.isRegistered);

    if (allGood) {
        console.log("✅ All emitters are correctly registered!");
        console.log("   Both bridges trust each other for cross-chain messaging.");
    } else {
        console.log("❌ Some emitters are not correctly registered:");
        for (const result of results) {
            if (!result.isRegistered) {
                console.log(`   - ${result.side}: Expected ${result.expectedEmitter}`);
                console.log(`                   Got ${result.registeredEmitter}`);
                if (result.isEnabled === false) {
                    console.log(`                   (emitter exists but is disabled)`);
                }
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
