#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();

import { getAddress } from "viem";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { TestWallet } from "@aztec/test-wallet/server";
import { MessageBridgeContract, MessageBridgeContractArtifact } from "../ts/artifacts";
import { loadAccount, getTestnetPxeConfig, testnetSendWaitOpts } from "./utils/aztec";
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

async function configureEvmBridge() {
    console.log("\n=== Configuring EVM MessageBridge ===");
    console.log(`EVM Bridge: ${EVM_BRIDGE_ADDRESS}`);
    console.log(`Aztec Chain ID: ${AZTEC_WORMHOLE_CHAIN_ID}`);
    console.log(`Aztec Wormhole (emitter): ${AZTEC_WORMHOLE_ADDRESS}`);
    console.log(`Aztec Bridge (sender): ${AZTEC_BRIDGE_ADDRESS}`);

    const { account, publicClient, walletClient } = createEvmClients(ARBITRUM_RPC_URL!, EVM_PRIVATE_KEY!);
    const evmBridgeAddress = getAddress(EVM_BRIDGE_ADDRESS!);

    // Check ownership first
    const owner = await publicClient.readContract({
        address: evmBridgeAddress,
        abi: MESSAGE_BRIDGE_ABI,
        functionName: "owner",
    });

    if (owner.toLowerCase() !== account.address.toLowerCase()) {
        throw new Error(`Not owner of EVM bridge. Owner: ${owner}, You: ${account.address}`);
    }

    // Register the Aztec Wormhole contract as the emitter
    const aztecEmitterBytes32 = addressToBytes32(AZTEC_WORMHOLE_ADDRESS!);
    const isEmitterRegistered = await publicClient.readContract({
        address: evmBridgeAddress,
        abi: MESSAGE_BRIDGE_ABI,
        functionName: "registeredEmitters",
        args: [AZTEC_WORMHOLE_CHAIN_ID, aztecEmitterBytes32],
    }) as boolean;

    if (isEmitterRegistered) {
        console.log("Aztec emitter already registered on EVM bridge");
    } else {
        console.log("Registering Aztec emitter on EVM bridge...");
        const hash = await walletClient.writeContract({
            address: evmBridgeAddress,
            abi: MESSAGE_BRIDGE_ABI,
            functionName: "registerEmitter",
            args: [AZTEC_WORMHOLE_CHAIN_ID, aztecEmitterBytes32],
        });
        console.log(`Transaction submitted: ${hash}`);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
    }

    // Register the Aztec Bridge contract as the trusted sender
    const aztecSenderBytes32 = addressToBytes32(AZTEC_BRIDGE_ADDRESS!);
    const isSenderRegistered = await publicClient.readContract({
        address: evmBridgeAddress,
        abi: MESSAGE_BRIDGE_ABI,
        functionName: "registeredSenders",
        args: [AZTEC_WORMHOLE_CHAIN_ID, aztecSenderBytes32],
    }) as boolean;

    if (isSenderRegistered) {
        console.log("Aztec sender already registered on EVM bridge");
    } else {
        console.log("Registering Aztec sender on EVM bridge...");
        const hash = await walletClient.writeContract({
            address: evmBridgeAddress,
            abi: MESSAGE_BRIDGE_ABI,
            functionName: "registerSender",
            args: [AZTEC_WORMHOLE_CHAIN_ID, aztecSenderBytes32],
        });
        console.log(`Transaction submitted: ${hash}`);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
    }

    console.log("EVM bridge configured successfully!");
}

async function configureAztecBridge() {
    console.log("\n=== Configuring Aztec MessageBridge ===");
    console.log(`Aztec Bridge: ${AZTEC_BRIDGE_ADDRESS}`);
    console.log(`EVM Chain ID: ${ARBITRUM_SEPOLIA_CHAIN_ID}`);
    console.log(`EVM Wormhole (emitter): ${EVM_WORMHOLE_ADDRESS}`);

    const node = createAztecNodeClient(AZTEC_NODE_URL!);
    const wallet = await TestWallet.create(node, getTestnetPxeConfig());
    const adminAddress = await loadAccount(node, wallet);

    console.log(`Using admin account: ${adminAddress.toString()}`);

    // ensure bridge contract is registered
    const bridgeAddress = AztecAddress.fromString(AZTEC_BRIDGE_ADDRESS!);
    const instance = await node.getContract(bridgeAddress);
    if (!instance) throw new Error("Aztec bridge contract not registered in node");
    await wallet.registerContract(instance, MessageBridgeContractArtifact)

    const bridge = await MessageBridgeContract.at(
        AztecAddress.fromString(AZTEC_BRIDGE_ADDRESS!),
        wallet
    );

    // Register the EVM Wormhole contract as the emitter (not the bridge)
    const evmEmitterBytes = hexToBytes32Array(EVM_WORMHOLE_ADDRESS!);

    // Check ownership
    const owner = await bridge.methods.get_owner().simulate({ from: adminAddress });
    if (!owner.equals(adminAddress)) {
        throw new Error(`Not owner of Aztec bridge. Owner: ${owner.toString()}, You: ${adminAddress.toString()}`);
    }

    // Register the EVM emitter
    console.log("Registering EVM emitter on Aztec bridge...");
    const opts = await testnetSendWaitOpts(node, wallet, adminAddress);

    await bridge.methods
        .register_emitter(ARBITRUM_SEPOLIA_CHAIN_ID, evmEmitterBytes as any)
        .send(opts.send)
        .wait(opts.wait);

    console.log("Aztec bridge configured successfully!");
}

async function main() {
    console.log("Configuring cross-chain bridges...");
    console.log(`Aztec Wormhole Chain ID: ${AZTEC_WORMHOLE_CHAIN_ID}`);
    console.log(`Arbitrum Sepolia Wormhole Chain ID: ${ARBITRUM_SEPOLIA_CHAIN_ID}`);

    // Configure both sides
    await configureEvmBridge();
    await configureAztecBridge();

    console.log("\n=== Configuration Complete ===");
    console.log("Both bridges are now configured to trust each other.");
    console.log("\nYou can now send messages between chains:");
    console.log("  - Aztec -> EVM: pnpm --filter @wormhole-demo/aztec send");
}

main().catch((err) => {
    console.error("Configuration failed:", err);
    process.exit(1);
});
