#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();

import {
    type BaseMessageBridgeEmitter,
    type EmitterConfig,
    WORMHOLE_CHAIN_IDS,
    NetworkName
} from "@aztec-wormhole-demo/shared";
import { createAllClients } from "./utils/clients";

async function main() {
    console.log("Configuring cross-chain bridges...\n");

    const clients = await createAllClients();
    const networks = Object.keys(clients) as NetworkName[];
    let totalRegistered = 0;

    for (const sourceNetwork of networks) {
        const sourceClient = clients[sourceNetwork];
        console.log(`\n=== ${sourceClient.chainName} ===`);
        const toRegister: EmitterConfig[] = [];
        for (const targetNetwork of networks) {
            if (sourceNetwork === targetNetwork) continue;
            const targetClient = clients[targetNetwork];
            const targetChainId = WORMHOLE_CHAIN_IDS[targetNetwork];
            const emitterAddress = targetClient.getEmitterAddress();
            const registered = await sourceClient.isEmitterRegistered(
                targetChainId,
                emitterAddress
            );
            if (registered) console.log(`  ${targetClient.chainName}: already registered`);
            else {
                console.log(`  ${targetClient.chainName}: needs registration`);
                toRegister.push({
                    chainId: targetChainId,
                    emitter: emitterAddress,
                    isDefaultPayload: targetNetwork !== "aztec"
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
        console.log(`Registered ${totalRegistered} emitter(s) across ${networks.length} chains.`);
    } else {
        console.log("All emitters already registered!");
    }
}

main().catch((err) => {
    console.error("Registration failed:", err);
    process.exit(1);
});
