#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();
import { createEvmClient, createSolanaClient } from "./utils/clients";

async function main() {
    const arb = await createEvmClient("arbitrum");
    const base = await createEvmClient("base");
    const sol = await createSolanaClient();

    console.log("Arbitrum:", await arb.getCurrentValue());
    console.log("Base:", await base.getCurrentValue());
    console.log("Solana:", await sol.getCurrentValue());
}

main();
