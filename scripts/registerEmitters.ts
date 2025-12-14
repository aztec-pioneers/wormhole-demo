#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();

import {
    type BaseMessageBridgeClient,
    type EmitterConfig,
    WORMHOLE_CHAIN_ID_SOLANA,
    WORMHOLE_CHAIN_ID_ARBITRUM_SEPOLIA,
    WORMHOLE_CHAIN_ID_BASE_SEPOLIA,
    WORMHOLE_CHAIN_ID_AZTEC,
} from "@aztec-wormhole-demo/shared";
import { createAllClients, type ChainId } from "./utils/clients";

// Chain configuration
interface ChainConfig {
    wormholeChainId: number;
    /** false for Aztec (50-byte payload with txId), true for others (18-byte) */
    isDefaultPayload: boolean;
}

const CHAIN_CONFIG: Record<ChainId, ChainConfig> = {
    arbitrum: { wormholeChainId: WORMHOLE_CHAIN_ID_ARBITRUM_SEPOLIA, isDefaultPayload: true },
    base: { wormholeChainId: WORMHOLE_CHAIN_ID_BASE_SEPOLIA, isDefaultPayload: true },
    aztec: { wormholeChainId: WORMHOLE_CHAIN_ID_AZTEC, isDefaultPayload: false },
    solana: { wormholeChainId: WORMHOLE_CHAIN_ID_SOLANA, isDefaultPayload: true },
};

async function main() {
    console.log("Configuring cross-chain bridges...\n");

    const clients = await createAllClients();
    const chainIds = Object.keys(clients) as ChainId[];
    let totalRegistered = 0;

    for (const sourceChainId of chainIds) {
        const sourceClient = clients[sourceChainId];
        console.log(`\n=== ${sourceClient.chainName} ===`);

        const toRegister: EmitterConfig[] = [];

        for (const targetChainId of chainIds) {
            if (sourceChainId === targetChainId) continue;

            const targetClient = clients[targetChainId];
            const targetConfig = CHAIN_CONFIG[targetChainId];
            const emitterAddress = targetClient.getEmitterAddress();

            const registered = await sourceClient.isEmitterRegistered(
                targetConfig.wormholeChainId,
                emitterAddress
            );

            if (registered) {
                console.log(`  ${targetClient.chainName}: already registered`);
            } else {
                console.log(`  ${targetClient.chainName}: needs registration`);
                toRegister.push({
                    chainId: targetConfig.wormholeChainId,
                    emitter: emitterAddress,
                    isDefaultPayload: targetConfig.isDefaultPayload,
                });
            }
        }

        if (toRegister.length > 0) {
            console.log(`  Registering ${toRegister.length} emitter(s)...`);
            await sourceClient.registerEmitters(toRegister);
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
