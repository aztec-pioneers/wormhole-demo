#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();

import {
    WORMHOLE_CHAIN_ID_SOLANA,
    WORMHOLE_CHAIN_ID_ARBITRUM_SEPOLIA,
    WORMHOLE_CHAIN_ID_BASE_SEPOLIA,
    WORMHOLE_CHAIN_ID_AZTEC,
} from "@aztec-wormhole-demo/shared";
import { createAllClients, type ChainId } from "./utils/clients";

const CHAIN_CONFIG: Record<ChainId, { wormholeChainId: number }> = {
    arbitrum: { wormholeChainId: WORMHOLE_CHAIN_ID_ARBITRUM_SEPOLIA },
    base: { wormholeChainId: WORMHOLE_CHAIN_ID_BASE_SEPOLIA },
    aztec: { wormholeChainId: WORMHOLE_CHAIN_ID_AZTEC },
    solana: { wormholeChainId: WORMHOLE_CHAIN_ID_SOLANA },
};

interface CheckResult {
    checker: string;
    target: string;
    registered: boolean;
}

async function main() {
    console.log("Checking cross-chain bridge emitter registrations...\n");

    const clients = await createAllClients();
    const chainIds = Object.keys(clients) as ChainId[];
    const results: CheckResult[] = [];

    for (const sourceChainId of chainIds) {
        const sourceClient = clients[sourceChainId];

        for (const targetChainId of chainIds) {
            if (sourceChainId === targetChainId) continue;

            const targetClient = clients[targetChainId];
            const targetConfig = CHAIN_CONFIG[targetChainId];
            const emitterAddress = targetClient.getEmitterAddress();

            const registered = await sourceClient.isEmitterRegistered(
                targetConfig.wormholeChainId,
                emitterAddress
            );

            results.push({
                checker: sourceClient.chainName,
                target: targetClient.chainName,
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
