#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { MessageBridgeClient } from "../packages/solana/ts/dist/index.js";

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const PROGRAM_ID = process.env.SOLANA_BRIDGE_PROGRAM_ID;

async function main() {
    if (!PROGRAM_ID) {
        throw new Error("SOLANA_BRIDGE_PROGRAM_ID not set");
    }

    console.log("Testing Solana SDK...");
    console.log(`  Program ID: ${PROGRAM_ID}`);

    // Load wallet
    const walletPath = join(process.env.HOME || "~", ".config/solana/id.json");
    if (!existsSync(walletPath)) {
        throw new Error(`Wallet not found at ${walletPath}`);
    }
    const walletKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8")))
    );
    console.log(`  Wallet: ${walletKeypair.publicKey.toBase58()}`);

    // Create client
    const connection = new Connection(SOLANA_RPC_URL, "confirmed");
    const client = new MessageBridgeClient(connection, {
        programId: new PublicKey(PROGRAM_ID),
    });

    // Get PDAs
    const pdas = client.getPDAs();
    console.log(`\nPDAs derived by SDK:`);
    console.log(`  Config: ${pdas.config.toBase58()}`);
    console.log(`  Counter: ${pdas.counter.toBase58()}`);
    console.log(`  Emitter: ${pdas.wormholeEmitter.toBase58()}`);

    // Read counter using SDK
    console.log(`\n1. Reading counter via SDK...`);
    const counter = await client.getCounter();
    console.log(`   Current count: ${counter?.count ?? "not initialized"}`);

    // Increment counter using SDK
    console.log(`\n2. Incrementing via SDK...`);
    const sig = await client.incrementCounter(walletKeypair);
    console.log(`   Transaction: ${sig}`);

    // Read again
    console.log(`\n3. Reading new count...`);
    const newCounter = await client.getCounter();
    console.log(`   New count: ${newCounter?.count}`);

    console.log(`\n========================================`);
    console.log(`SDK test complete! Counter: ${counter?.count} → ${newCounter?.count}`);
    console.log(`========================================`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
