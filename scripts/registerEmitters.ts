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

    // Collect emitters to register
    const chainIds: number[] = [];
    const emitterAddresses: `0x${string}`[] = [];
    const isDefaultPayloads: boolean[] = [];

    // Check Aztec emitter (isDefaultPayload = false, Aztec uses 50-byte payload with txId)
    const aztecEmitterBytes32 = addressToBytes32(AZTEC_WORMHOLE_ADDRESS!);
    const aztecRegistered = await publicClient.readContract({
        address: evmBridgeAddress,
        abi: MESSAGE_BRIDGE_ABI,
        functionName: "registeredEmitters",
        args: [WORMHOLE_CHAIN_ID_AZTEC],
    }) as `0x${string}`;

    if (aztecRegistered.toLowerCase() === aztecEmitterBytes32.toLowerCase()) {
        console.log(`  Aztec emitter (chain ${WORMHOLE_CHAIN_ID_AZTEC}) already registered`);
    } else {
        chainIds.push(WORMHOLE_CHAIN_ID_AZTEC);
        emitterAddresses.push(aztecEmitterBytes32);
        isDefaultPayloads.push(false); // Aztec uses 50-byte payload with txId
    }

    // Check Solana emitter if enabled (isDefaultPayload = true, Solana uses 18-byte default payload)
    if (SOLANA_ENABLED) {
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
            console.log(`  Solana emitter (chain ${CHAIN_ID_SOLANA}) already registered`);
        } else {
            chainIds.push(CHAIN_ID_SOLANA);
            emitterAddresses.push(solanaEmitterBytes32);
            isDefaultPayloads.push(true); // Solana uses 18-byte default payload
        }
    }

    // Check other EVM chain emitter if configured (isDefaultPayload = true, EVM uses 18-byte default payload)
    if (otherEvmConfig) {
        const otherEvmEmitterBytes32 = addressToBytes32(otherEvmConfig.bridgeAddress);

        const otherEvmRegistered = await publicClient.readContract({
            address: evmBridgeAddress,
            abi: MESSAGE_BRIDGE_ABI,
            functionName: "registeredEmitters",
            args: [otherEvmConfig.wormholeChainId],
        }) as `0x${string}`;

        if (otherEvmRegistered.toLowerCase() === otherEvmEmitterBytes32.toLowerCase()) {
            console.log(`  ${otherEvmConfig.displayName} emitter (chain ${otherEvmConfig.wormholeChainId}) already registered`);
        } else {
            chainIds.push(otherEvmConfig.wormholeChainId);
            emitterAddresses.push(otherEvmEmitterBytes32);
            isDefaultPayloads.push(true); // EVM uses 18-byte default payload
        }
    }

    // Batch register all unregistered emitters in a single transaction
    if (chainIds.length > 0) {
        console.log(`\n  Registering ${chainIds.length} emitter(s) in a single transaction...`);
        const hash = await walletClient.writeContract({
            address: evmBridgeAddress,
            abi: MESSAGE_BRIDGE_ABI,
            functionName: "registerEmitters",
            args: [chainIds, emitterAddresses, isDefaultPayloads],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        console.log(`    Registered in block ${receipt.blockNumber}`);
    }

    console.log(`${config.displayName} bridge configuration complete!`);
}

async function configureArbitrumBridge() {
    const config: EvmChainConfig = {
        rpcUrl: ARBITRUM_RPC_URL!,
        bridgeAddress: ARBITRUM_BRIDGE_ADDRESS!,
        wormholeChainId: WORMHOLE_CHAIN_ID_ARBITRUM_SEPOLIA,
        displayName: "Arbitrum Sepolia",
    };

    const otherEvmConfig = BASE_ENABLED ? {
        bridgeAddress: BASE_BRIDGE_ADDRESS!,
        wormholeChainId: WORMHOLE_CHAIN_ID_BASE_SEPOLIA,
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

    // Collect emitters to register
    const chainIds: number[] = [];
    const emitterAddresses: Uint8Array[] = [];

    // Check Arbitrum emitter
    const arbEmitterBytes = hexToBytes32Array(ARBITRUM_BRIDGE_ADDRESS!);
    const arbRegistered = await bridge.methods
        .is_emitter_registered(ARBITRUM_SEPOLIA_CHAIN_ID, arbEmitterBytes as any)
        .simulate({ from: adminAddress });

    if (arbRegistered) {
        console.log(`  Arbitrum emitter (chain ${ARBITRUM_SEPOLIA_CHAIN_ID}) already registered`);
    } else {
        chainIds.push(ARBITRUM_SEPOLIA_CHAIN_ID);
        emitterAddresses.push(arbEmitterBytes);
    }

    // Check Base emitter if enabled
    if (BASE_ENABLED) {
        const baseEmitterBytes = hexToBytes32Array(BASE_BRIDGE_ADDRESS!);
        const baseRegistered = await bridge.methods
            .is_emitter_registered(BASE_SEPOLIA_CHAIN_ID, baseEmitterBytes as any)
            .simulate({ from: adminAddress });

        if (baseRegistered) {
            console.log(`  Base emitter (chain ${BASE_SEPOLIA_CHAIN_ID}) already registered`);
        } else {
            chainIds.push(BASE_SEPOLIA_CHAIN_ID);
            emitterAddresses.push(baseEmitterBytes);
        }
    }

    // Check Solana emitter if enabled
    if (SOLANA_ENABLED) {
        const { client } = createSolanaClient(SOLANA_RPC_URL!, SOLANA_BRIDGE_PROGRAM_ID!);
        const solanaEmitter = client.getEmitterAddress();
        const solanaEmitterBytes = hexToBytes32Array(formatEmitterAddress(solanaEmitter));

        const solanaRegistered = await bridge.methods
            .is_emitter_registered(CHAIN_ID_SOLANA, solanaEmitterBytes as any)
            .simulate({ from: adminAddress });

        if (solanaRegistered) {
            console.log(`  Solana emitter (chain ${CHAIN_ID_SOLANA}) already registered`);
        } else {
            chainIds.push(CHAIN_ID_SOLANA);
            emitterAddresses.push(solanaEmitterBytes);
        }
    }

    // Batch register all unregistered emitters in a single transaction
    if (chainIds.length > 0) {
        console.log(`\n  Registering ${chainIds.length} emitter(s) in a single transaction...`);
        await bridge.methods
            .register_emitter(chainIds as any, emitterAddresses as any)
            .send(opts.send)
            .wait(opts.wait);
        console.log("    Emitters registered!");
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

    // Collect emitters to register
    const emitters: Array<{ chainId: number; emitterAddress: Uint8Array; isDefaultPayload: boolean }> = [];

    // Check Arbitrum emitter (isDefaultPayload = true, EVM uses 18-byte default payload)
    const arbEmitterBytes = MessageBridgeClient.evmAddressToWormhole(ARBITRUM_BRIDGE_ADDRESS!);
    const arbEmitter = await client.getForeignEmitter(CHAIN_ID_ARBITRUM_SEPOLIA);
    if (arbEmitter && Buffer.from(arbEmitter.address).equals(Buffer.from(arbEmitterBytes))) {
        console.log(`  Arbitrum emitter (chain ${CHAIN_ID_ARBITRUM_SEPOLIA}) already registered`);
    } else {
        emitters.push({
            chainId: CHAIN_ID_ARBITRUM_SEPOLIA,
            emitterAddress: arbEmitterBytes,
            isDefaultPayload: true, // EVM uses 18-byte default payload
        });
    }

    // Check Base emitter if enabled (isDefaultPayload = true, EVM uses 18-byte default payload)
    if (BASE_ENABLED) {
        const baseEmitterBytes = MessageBridgeClient.evmAddressToWormhole(BASE_BRIDGE_ADDRESS!);
        const baseEmitter = await client.getForeignEmitter(CHAIN_ID_BASE_SEPOLIA);
        if (baseEmitter && Buffer.from(baseEmitter.address).equals(Buffer.from(baseEmitterBytes))) {
            console.log(`  Base emitter (chain ${CHAIN_ID_BASE_SEPOLIA}) already registered`);
        } else {
            emitters.push({
                chainId: CHAIN_ID_BASE_SEPOLIA,
                emitterAddress: baseEmitterBytes,
                isDefaultPayload: true, // EVM uses 18-byte default payload
            });
        }
    }

    // Check Aztec emitter (isDefaultPayload = false, Aztec uses 50-byte payload with txId)
    const aztecEmitterBytes = MessageBridgeClient.aztecAddressToWormhole(AZTEC_WORMHOLE_ADDRESS!);
    const aztecEmitter = await client.getForeignEmitter(CHAIN_ID_AZTEC);
    if (aztecEmitter && Buffer.from(aztecEmitter.address).equals(Buffer.from(aztecEmitterBytes))) {
        console.log(`  Aztec emitter (chain ${CHAIN_ID_AZTEC}) already registered`);
    } else {
        emitters.push({
            chainId: CHAIN_ID_AZTEC,
            emitterAddress: aztecEmitterBytes,
            isDefaultPayload: false, // Aztec uses 50-byte payload with txId
        });
    }

    // Batch register all unregistered emitters in a single transaction
    if (emitters.length > 0) {
        console.log(`\n  Registering ${emitters.length} emitter(s) in a single transaction...`);
        const sig = await client.registerEmitters(owner, emitters);
        console.log(`    Registered! Signature: ${sig}`);
    }

    console.log("Solana bridge configuration complete!");
}

async function main() {
    console.log("Configuring cross-chain bridges...");
    console.log(`\nChain IDs:`);
    console.log(`  Aztec: ${WORMHOLE_CHAIN_ID_AZTEC}`);
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
