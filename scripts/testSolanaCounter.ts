#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();

import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    TransactionInstruction,
    SystemProgram,
    sendAndConfirmTransaction,
} from "@solana/web3.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const PROGRAM_ID = process.env.SOLANA_BRIDGE_PROGRAM_ID;

// Instruction discriminators from the IDL
const INITIALIZE_COUNTER_DISCRIMINATOR = Buffer.from([67, 89, 100, 87, 231, 172, 35, 124]);
const INCREMENT_COUNTER_DISCRIMINATOR = Buffer.from([16, 125, 2, 171, 73, 24, 207, 229]);

async function main() {
    if (!PROGRAM_ID) {
        throw new Error("SOLANA_BRIDGE_PROGRAM_ID not set. Run 'pnpm deploy:solana' first.");
    }

    console.log("Testing Solana MessageBridge Counter...");
    console.log(`  RPC URL: ${SOLANA_RPC_URL}`);
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

    const connection = new Connection(SOLANA_RPC_URL, "confirmed");
    const programId = new PublicKey(PROGRAM_ID);

    // Derive counter PDA
    const [counterPda, counterBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("counter")],
        programId
    );

    console.log(`  Counter PDA: ${counterPda.toBase58()}`);

    // Check balance
    const balance = await connection.getBalance(walletKeypair.publicKey);
    console.log(`  Balance: ${balance / 1e9} SOL`);

    // 1. Check if counter exists, initialize if not
    let counterAccount = await connection.getAccountInfo(counterPda);
    if (!counterAccount) {
        console.log("\n1. Initializing counter...");

        const initIx = new TransactionInstruction({
            keys: [
                { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },
                { pubkey: counterPda, isSigner: false, isWritable: true },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId,
            data: INITIALIZE_COUNTER_DISCRIMINATOR,
        });

        const tx = new Transaction().add(initIx);
        const sig = await sendAndConfirmTransaction(connection, tx, [walletKeypair]);
        console.log(`   Transaction: ${sig}`);

        // Refetch account
        counterAccount = await connection.getAccountInfo(counterPda);
    } else {
        console.log("\n1. Counter already initialized.");
    }

    // 2. Read current counter value
    console.log("\n2. Reading counter value...");
    if (counterAccount) {
        // Skip 8-byte discriminator, then read u64
        const countValue = counterAccount.data.readBigUInt64LE(8);
        console.log(`   Current count: ${countValue}`);
    }

    // 3. Increment counter
    console.log("\n3. Incrementing counter...");
    const incrementIx = new TransactionInstruction({
        keys: [
            { pubkey: counterPda, isSigner: false, isWritable: true },
        ],
        programId,
        data: INCREMENT_COUNTER_DISCRIMINATOR,
    });

    const incrementTx = new Transaction().add(incrementIx);
    const incrementSig = await sendAndConfirmTransaction(connection, incrementTx, [walletKeypair]);
    console.log(`   Transaction: ${incrementSig}`);

    // 4. Read new counter value
    console.log("\n4. Reading new counter value...");
    const newCounterAccount = await connection.getAccountInfo(counterPda);
    if (newCounterAccount) {
        const newCountValue = newCounterAccount.data.readBigUInt64LE(8);
        console.log(`   New count: ${newCountValue}`);
    }

    // 5. Increment again
    console.log("\n5. Incrementing again...");
    const incrementTx2 = new Transaction().add(incrementIx);
    const incrementSig2 = await sendAndConfirmTransaction(connection, incrementTx2, [walletKeypair]);
    console.log(`   Transaction: ${incrementSig2}`);

    // 6. Final read
    console.log("\n6. Final counter value...");
    const finalCounterAccount = await connection.getAccountInfo(counterPda);
    if (finalCounterAccount) {
        const finalCountValue = finalCounterAccount.data.readBigUInt64LE(8);
        console.log(`   Final count: ${finalCountValue}`);

        console.log("\n========================================");
        console.log("Counter test complete!");
        console.log(`Counter value: ${finalCountValue}`);
        console.log("========================================");
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
