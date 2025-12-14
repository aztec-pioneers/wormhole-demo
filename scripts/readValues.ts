#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();

import { createAllClients, type ChainId } from "./utils/clients";

async function main() {
    console.log("Reading bridge state from all chains...\n");

    let clients: Record<ChainId, any>;
    try {
        clients = await createAllClients();
    } catch (err) {
        console.error("Failed to create all clients:", err);
        process.exit(1);
    }

    for (const [chainId, client] of Object.entries(clients)) {
        console.log(`=== ${client.chainName} ===`);
        try {
            const currentValue = await client.getCurrentValue();
            console.log(`  Current value: ${currentValue ?? "Not set"}`);
        } catch (err: any) {
            console.log(`  Error: ${err.message}`);
        }
        console.log();
    }
}

main().catch(console.error);
