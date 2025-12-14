#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();

import { WORMHOLE_CHAIN_IDS, NetworkName } from "@aztec-wormhole-demo/shared";
import { createAllClients } from "./utils/clients";

interface CheckResult {
    source: string;
    destination: string;
    registered: boolean;
}

async function main() {
    console.log("Checking cross-chain bridge emitter registrations...\n");
    const clients = await createAllClients();
    const networks = Object.keys(clients) as NetworkName[];
    const results: CheckResult[] = [];

    for (const sourceNetwork of networks) {
        const sourceClient = clients[sourceNetwork];
        for (const targetNetwork of networks) {
            if (sourceNetwork === targetNetwork) continue;
            const targetClient = clients[targetNetwork];
            const targetChainId = WORMHOLE_CHAIN_IDS[targetNetwork];
            const emitterAddress = targetClient.getEmitterAddress();
            const registered = await sourceClient.isEmitterRegistered(
                targetChainId,
                emitterAddress
            );
            results.push({
                source: sourceClient.chainName,
                destination: targetClient.chainName,
                registered,
            });
        }
    }

    // Print results table
    console.log("Registration Matrix:");
    console.log("─".repeat(50));
    console.log(`${"Source".padEnd(12)} ${"Destination".padEnd(12)} ${"Status".padEnd(15)}`);
    console.log("─".repeat(50));

    for (const r of results) {
        const status = r.registered ? "✓ REGISTERED" : "✗ MISSING";
        console.log(`${r.source.padEnd(12)} ${r.destination.padEnd(12)} ${status}`);
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
