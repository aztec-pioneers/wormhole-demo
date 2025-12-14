#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();

import { createAllClients } from "./utils/clients";
import { BaseMessageBridgeEmitter, NetworkName } from "@aztec-wormhole-demo/shared";

async function main() {
    console.log("Reading bridge state from all chains...\n");

    let clients: Record<NetworkName, BaseMessageBridgeEmitter>;
    try {
        clients = await createAllClients();
    } catch (err) {
        console.error("Failed to create all clients:", err);
        process.exit(1);
    }

    for (const client of Object.values(clients)) {
        console.log(`=== ${client.chainName} ===`);
        try {
            const currentValue = await client.getCurrentValue();
            console.log(`  Current value: ${currentValue ?? "Not set"}`);
        } catch (err: any) {
            console.log(`  Error: ${err.message}`);
        }
    }
}

main().catch(console.error);
