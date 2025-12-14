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
import { AZTEC_WORMHOLE_CHAIN_ID, ARBITRUM_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID } from "@aztec-wormhole-demo/aztec-contracts/constants";
import {
    CHAIN_ID_SOLANA,
    CHAIN_ID_ARBITRUM_SEPOLIA,
    CHAIN_ID_BASE_SEPOLIA,
    CHAIN_ID_AZTEC,
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

interface EvmChainConfig {
    rpcUrl: string;
    bridgeAddress: string;
    wormholeChainId: number;
    displayName: string;
}

async function configureEvmBridge(
    chainName: EvmChainName,
    config: EvmChainConfig,
    otherEvmConfig?: { bridgeAddress: string; wormholeChainId: number; displayName: string }
) {
    console.log(`\n=== Configuring ${config.displayName} MessageBridge ===`);
    console.log(`Bridge: ${config.bridgeAddress}`);

    const { account, publicClient, walletClient } = createEvmClients(config.rpcUrl, EVM_PRIVATE_KEY!, chainName);
    const evmBridgeAddress = getAddress(config.bridgeAddress);

    // Check ownership
    const owner = await publicClient.readContract({
        address: evmBridgeAddress,
        abi: MESSAGE_BRIDGE_ABI,
        functionName: "owner",
    });

    if (owner.toLowerCase() !== account.address.toLowerCase()) {
        throw new Error(`Not owner of ${config.displayName} bridge. Owner: ${owner}, You: ${account.address}`);
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

    // Register other EVM chain emitter if configured (isDefaultPayload = true, EVM uses 18-byte default payload)
    if (otherEvmConfig) {
        console.log(`\n  Registering ${otherEvmConfig.displayName} emitter (chain ${otherEvmConfig.wormholeChainId})...`);
        const otherEvmEmitterBytes32 = addressToBytes32(otherEvmConfig.bridgeAddress);

        const otherEvmRegistered = await publicClient.readContract({
            address: evmBridgeAddress,
            abi: MESSAGE_BRIDGE_ABI,
            functionName: "registeredEmitters",
            args: [otherEvmConfig.wormholeChainId],
        }) as `0x${string}`;

        if (otherEvmRegistered.toLowerCase() === otherEvmEmitterBytes32.toLowerCase()) {
            console.log(`    ${otherEvmConfig.displayName} emitter already registered`);
        } else {
            const hash = await walletClient.writeContract({
                address: evmBridgeAddress,
                abi: MESSAGE_BRIDGE_ABI,
                functionName: "registerEmitter",
                args: [otherEvmConfig.wormholeChainId, otherEvmEmitterBytes32, true], // true = default payload (18 bytes)
            });
            const receipt = await publicClient.waitForTransactionReceipt({ hash });
            console.log(`    Registered in block ${receipt.blockNumber}`);
        }
    }

    console.log(`${config.displayName} bridge configuration complete!`);
}

async function configureArbitrumBridge() {
    const config: EvmChainConfig = {
        rpcUrl: ARBITRUM_RPC_URL!,
        bridgeAddress: ARBITRUM_BRIDGE_ADDRESS!,
        wormholeChainId: ARBITRUM_SEPOLIA_CHAIN_ID,
        displayName: "Arbitrum Sepolia",
    };

    const otherEvmConfig = BASE_ENABLED ? {
        bridgeAddress: BASE_BRIDGE_ADDRESS!,
        wormholeChainId: BASE_SEPOLIA_CHAIN_ID,
        displayName: "Base Sepolia",
    } : undefined;

    await configureEvmBridge("arbitrum", config, otherEvmConfig);
}

async function configureBaseBridge() {
    if (!BASE_ENABLED) {
        console.log("\n=== Skipping Base MessageBridge (not configured) ===");
        return;
    }

    const config: EvmChainConfig = {
        rpcUrl: BASE_RPC_URL!,
        bridgeAddress: BASE_BRIDGE_ADDRESS!,
        wormholeChainId: BASE_SEPOLIA_CHAIN_ID,
        displayName: "Base Sepolia",
    };

    const otherEvmConfig = {
        bridgeAddress: ARBITRUM_BRIDGE_ADDRESS!,
        wormholeChainId: ARBITRUM_SEPOLIA_CHAIN_ID,
        displayName: "Arbitrum Sepolia",
    };

    await configureEvmBridge("base", config, otherEvmConfig);
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

    // Register Arbitrum emitter
    console.log(`\n  Registering Arbitrum emitter (chain ${ARBITRUM_SEPOLIA_CHAIN_ID})...`);
    const arbEmitterBytes = hexToBytes32Array(ARBITRUM_BRIDGE_ADDRESS!);

    const arbRegistered = await bridge.methods
        .is_emitter_registered(ARBITRUM_SEPOLIA_CHAIN_ID, arbEmitterBytes as any)
        .simulate({ from: adminAddress });

    if (arbRegistered) {
        console.log("    Arbitrum emitter already registered");
    } else {
        await bridge.methods
            .register_emitter(ARBITRUM_SEPOLIA_CHAIN_ID, arbEmitterBytes as any)
            .send(opts.send)
            .wait(opts.wait);
        console.log("    Arbitrum emitter registered!");
    }

    // Register Base emitter if enabled
    if (BASE_ENABLED) {
        console.log(`\n  Registering Base emitter (chain ${BASE_SEPOLIA_CHAIN_ID})...`);
        const baseEmitterBytes = hexToBytes32Array(BASE_BRIDGE_ADDRESS!);

        const baseRegistered = await bridge.methods
            .is_emitter_registered(BASE_SEPOLIA_CHAIN_ID, baseEmitterBytes as any)
            .simulate({ from: adminAddress });

        if (baseRegistered) {
            console.log("    Base emitter already registered");
        } else {
            await bridge.methods
                .register_emitter(BASE_SEPOLIA_CHAIN_ID, baseEmitterBytes as any)
                .send(opts.send)
                .wait(opts.wait);
            console.log("    Base emitter registered!");
        }
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
        console.log("  Program not initialized. Run deploy script first.");
        return;
    }

    // Register Arbitrum emitter (isDefaultPayload = true, EVM uses 18-byte default payload)
    console.log(`\n  Registering Arbitrum emitter (chain ${CHAIN_ID_ARBITRUM_SEPOLIA})...`);
    const arbEmitterBytes = MessageBridgeClient.evmAddressToWormhole(ARBITRUM_BRIDGE_ADDRESS!);

    const arbEmitter = await client.getForeignEmitter(CHAIN_ID_ARBITRUM_SEPOLIA);
    if (arbEmitter && Buffer.from(arbEmitter.address).equals(Buffer.from(arbEmitterBytes))) {
        console.log("    Arbitrum emitter already registered");
    } else {
        const sig = await client.registerEmitter(owner, CHAIN_ID_ARBITRUM_SEPOLIA, arbEmitterBytes, true); // true = default payload
        console.log(`    Registered! Signature: ${sig}`);
    }

    // Register Base emitter if enabled (isDefaultPayload = true, EVM uses 18-byte default payload)
    if (BASE_ENABLED) {
        console.log(`\n  Registering Base emitter (chain ${CHAIN_ID_BASE_SEPOLIA})...`);
        const baseEmitterBytes = MessageBridgeClient.evmAddressToWormhole(BASE_BRIDGE_ADDRESS!);

        const baseEmitter = await client.getForeignEmitter(CHAIN_ID_BASE_SEPOLIA);
        if (baseEmitter && Buffer.from(baseEmitter.address).equals(Buffer.from(baseEmitterBytes))) {
            console.log("    Base emitter already registered");
        } else {
            const sig = await client.registerEmitter(owner, CHAIN_ID_BASE_SEPOLIA, baseEmitterBytes, true); // true = default payload
            console.log(`    Registered! Signature: ${sig}`);
        }
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
    if (BASE_ENABLED) {
        console.log(`  Base Sepolia: ${BASE_SEPOLIA_CHAIN_ID}`);
    }
    if (SOLANA_ENABLED) {
        console.log(`  Solana: ${CHAIN_ID_SOLANA}`);
    }

    // Configure all bridges
    await configureArbitrumBridge();
    await configureBaseBridge();
    await configureAztecBridge();
    await configureSolanaBridge();

    const chainCount = [true, BASE_ENABLED, SOLANA_ENABLED].filter(Boolean).length + 1; // +1 for Aztec

    console.log("\n=== Emitter Registration Complete ===");
    console.log(`All ${chainCount} bridges are now registered to trust each other.`);
}

main().catch((err) => {
    console.error("Emitter registration failed:", err);
    process.exit(1);
});
