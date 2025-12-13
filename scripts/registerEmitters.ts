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
import { createEvmClients, MESSAGE_BRIDGE_ABI } from "./utils/evm";
import { createSolanaClient, loadKeypair, formatEmitterAddress } from "./utils/solana";
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

// Solana is optional
const SOLANA_ENABLED = SOLANA_RPC_URL && SOLANA_BRIDGE_PROGRAM_ID;

async function configureEvmBridge() {
    console.log("\n=== Configuring EVM MessageBridge ===");
    console.log(`EVM Bridge: ${EVM_BRIDGE_ADDRESS}`);

    const { account, publicClient, walletClient } = createEvmClients(ARBITRUM_RPC_URL!, EVM_PRIVATE_KEY!);
    const evmBridgeAddress = getAddress(EVM_BRIDGE_ADDRESS!);

    // Check ownership
    const owner = await publicClient.readContract({
        address: evmBridgeAddress,
        abi: MESSAGE_BRIDGE_ABI,
        functionName: "owner",
    });

    if (owner.toLowerCase() !== account.address.toLowerCase()) {
        throw new Error(`Not owner of EVM bridge. Owner: ${owner}, You: ${account.address}`);
    }

    // Register Aztec emitter (isDefaultPayload = false, Aztec uses 50-byte payload with txId)
    console.log(`\n  Registering Aztec emitter (chain ${AZTEC_WORMHOLE_CHAIN_ID})...`);
    const aztecEmitterBytes32 = addressToBytes32(AZTEC_WORMHOLE_ADDRESS!);

    const aztecRegistered = await publicClient.readContract({
        address: evmBridgeAddress,
        abi: MESSAGE_BRIDGE_ABI,
        functionName: "registeredEmitters",
        args: [AZTEC_WORMHOLE_CHAIN_ID],
    }) as `0x${string}`;

    if (aztecRegistered.toLowerCase() === aztecEmitterBytes32.toLowerCase()) {
        console.log("    Aztec emitter already registered");
    } else {
        const hash = await walletClient.writeContract({
            address: evmBridgeAddress,
            abi: MESSAGE_BRIDGE_ABI,
            functionName: "registerEmitter",
            args: [AZTEC_WORMHOLE_CHAIN_ID, aztecEmitterBytes32, false], // false = Aztec payload (50 bytes with txId)
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        console.log(`    Registered in block ${receipt.blockNumber}`);
    }

    // Register Solana emitter if enabled (isDefaultPayload = true, Solana uses 18-byte default payload)
    if (SOLANA_ENABLED) {
        console.log(`\n  Registering Solana emitter (chain ${CHAIN_ID_SOLANA})...`);
        const { client } = createSolanaClient(SOLANA_RPC_URL!, SOLANA_BRIDGE_PROGRAM_ID!);
        const solanaEmitter = client.getEmitterAddress();
        const solanaEmitterBytes32 = formatEmitterAddress(solanaEmitter) as `0x${string}`;

        const solanaRegistered = await publicClient.readContract({
            address: evmBridgeAddress,
            abi: MESSAGE_BRIDGE_ABI,
            functionName: "registeredEmitters",
            args: [CHAIN_ID_SOLANA],
        }) as `0x${string}`;

        if (solanaRegistered.toLowerCase() === solanaEmitterBytes32.toLowerCase()) {
            console.log("    Solana emitter already registered");
        } else {
            const hash = await walletClient.writeContract({
                address: evmBridgeAddress,
                abi: MESSAGE_BRIDGE_ABI,
                functionName: "registerEmitter",
                args: [CHAIN_ID_SOLANA, solanaEmitterBytes32, true], // true = default payload (18 bytes)
            });
            const receipt = await publicClient.waitForTransactionReceipt({ hash });
            console.log(`    Registered in block ${receipt.blockNumber}`);
        }
    }

    console.log("EVM bridge configuration complete!");
}

async function configureAztecBridge() {
    console.log("\n=== Configuring Aztec MessageBridge ===");
    console.log(`Aztec Bridge: ${AZTEC_BRIDGE_ADDRESS}`);

    const node = createAztecNodeClient(AZTEC_NODE_URL!);
    const wallet = await TestWallet.create(node, getTestnetPxeConfig());
    const adminAddress = await loadAccount(node, wallet);

    console.log(`Using admin account: ${adminAddress.toString()}`);

    // ensure bridge contract is registered
    const bridgeAddress = AztecAddress.fromString(AZTEC_BRIDGE_ADDRESS!);
    const instance = await node.getContract(bridgeAddress);
    if (!instance) throw new Error("Aztec bridge contract not registered in node");
    await wallet.registerContract(instance, MessageBridgeContractArtifact)

    const bridge = await MessageBridgeContract.at(bridgeAddress, wallet);

    // Check ownership
    const owner = await bridge.methods.get_owner().simulate({ from: adminAddress });
    if (!owner.equals(adminAddress)) {
        throw new Error(`Not owner of Aztec bridge. Owner: ${owner.toString()}, You: ${adminAddress.toString()}`);
    }

    const opts = await testnetSendWaitOpts(node, wallet, adminAddress);

    // Register EVM emitter
    console.log(`\n  Registering EVM emitter (chain ${ARBITRUM_SEPOLIA_CHAIN_ID})...`);
    const evmEmitterBytes = hexToBytes32Array(EVM_BRIDGE_ADDRESS!);

    const evmRegistered = await bridge.methods
        .is_emitter_registered(ARBITRUM_SEPOLIA_CHAIN_ID, evmEmitterBytes as any)
        .simulate({ from: adminAddress });

    if (evmRegistered) {
        console.log("    EVM emitter already registered");
    } else {
        await bridge.methods
            .register_emitter(ARBITRUM_SEPOLIA_CHAIN_ID, evmEmitterBytes as any)
            .send(opts.send)
            .wait(opts.wait);
        console.log("    EVM emitter registered!");
    }

    // Register Solana emitter if enabled
    if (SOLANA_ENABLED) {
        console.log(`\n  Registering Solana emitter (chain ${CHAIN_ID_SOLANA})...`);
        const { client } = createSolanaClient(SOLANA_RPC_URL!, SOLANA_BRIDGE_PROGRAM_ID!);
        const solanaEmitter = client.getEmitterAddress();
        const solanaEmitterBytes = hexToBytes32Array(formatEmitterAddress(solanaEmitter));

        const solanaRegistered = await bridge.methods
            .is_emitter_registered(CHAIN_ID_SOLANA, solanaEmitterBytes as any)
            .simulate({ from: adminAddress });

        if (solanaRegistered) {
            console.log("    Solana emitter already registered");
        } else {
            await bridge.methods
                .register_emitter(CHAIN_ID_SOLANA, solanaEmitterBytes as any)
                .send(opts.send)
                .wait(opts.wait);
            console.log("    Solana emitter registered!");
        }
    }

    console.log("Aztec bridge configuration complete!");
}

async function configureSolanaBridge() {
    if (!SOLANA_ENABLED) {
        console.log("\n=== Skipping Solana MessageBridge (not configured) ===");
        return;
    }

    console.log("\n=== Configuring Solana MessageBridge ===");
    console.log(`Solana Program: ${SOLANA_BRIDGE_PROGRAM_ID}`);

    const { client } = createSolanaClient(SOLANA_RPC_URL!, SOLANA_BRIDGE_PROGRAM_ID!);
    const owner = loadKeypair();

    console.log(`Using owner: ${owner.publicKey.toBase58()}`);

    // Check if initialized
    const isInitialized = await client.isInitialized();
    if (!isInitialized) {
        console.log("  ⚠️  Program not initialized. Run deploy script first.");
        return;
    }

    // Register EVM emitter (isDefaultPayload = true, EVM uses 18-byte default payload)
    console.log(`\n  Registering EVM emitter (chain ${CHAIN_ID_ARBITRUM_SEPOLIA})...`);
    const evmEmitterBytes = MessageBridgeClient.evmAddressToWormhole(EVM_BRIDGE_ADDRESS!);

    const evmEmitter = await client.getForeignEmitter(CHAIN_ID_ARBITRUM_SEPOLIA);
    if (evmEmitter && Buffer.from(evmEmitter.address).equals(Buffer.from(evmEmitterBytes))) {
        console.log("    EVM emitter already registered");
    } else {
        const sig = await client.registerEmitter(owner, CHAIN_ID_ARBITRUM_SEPOLIA, evmEmitterBytes, true); // true = default payload
        console.log(`    Registered! Signature: ${sig}`);
    }

    // Register Aztec emitter (isDefaultPayload = false, Aztec uses 50-byte payload with txId)
    console.log(`\n  Registering Aztec emitter (chain ${CHAIN_ID_AZTEC})...`);
    const aztecEmitterBytes = MessageBridgeClient.aztecAddressToWormhole(AZTEC_WORMHOLE_ADDRESS!);

    const aztecEmitter = await client.getForeignEmitter(CHAIN_ID_AZTEC);
    if (aztecEmitter && Buffer.from(aztecEmitter.address).equals(Buffer.from(aztecEmitterBytes))) {
        console.log("    Aztec emitter already registered");
    } else {
        const sig = await client.registerEmitter(owner, CHAIN_ID_AZTEC, aztecEmitterBytes, false); // false = Aztec payload (50 bytes)
        console.log(`    Registered! Signature: ${sig}`);
    }

    console.log("Solana bridge configuration complete!");
}

async function main() {
    console.log("Configuring cross-chain bridges...");
    console.log(`\nChain IDs:`);
    console.log(`  Aztec: ${AZTEC_WORMHOLE_CHAIN_ID}`);
    console.log(`  Arbitrum Sepolia: ${ARBITRUM_SEPOLIA_CHAIN_ID}`);
    if (SOLANA_ENABLED) {
        console.log(`  Solana: ${CHAIN_ID_SOLANA}`);
    }

    // Configure all bridges
    await configureEvmBridge();
    await configureAztecBridge();
    await configureSolanaBridge();

    console.log("\n=== Emitter Registration Complete ===");
    if (SOLANA_ENABLED) {
        console.log("All three bridges are now registered to trust each other.");
    } else {
        console.log("Both bridges are now registered to trust each other.");
    }
}

main().catch((err) => {
    console.error("Emitter registration failed:", err);
    process.exit(1);
});
