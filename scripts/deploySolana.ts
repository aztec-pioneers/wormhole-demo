#!/usr/bin/env node
import { loadRootEnv, updateRootEnv } from "./utils/env";
loadRootEnv();

import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { createSolanaClient, loadKeypair } from "./utils/solana";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOLANA_DIR = join(__dirname, "../packages/solana/message_bridge");
const IDL_PATH = join(SOLANA_DIR, "target/idl/message_bridge.json");
const KEYPAIR_PATH = join(SOLANA_DIR, "target/deploy/message_bridge-keypair.json");

// Default to devnet
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

async function main() {
    console.log("Deploying Solana MessageBridge program...");
    console.log(`  RPC URL: ${SOLANA_RPC_URL}`);

    // 1. Build the program first (in case there are changes)
    console.log("\n1. Building program...");
    execSync("anchor build", {
        cwd: SOLANA_DIR,
        stdio: "inherit",
    });

    // 2. Get the program ID from the keypair
    if (!existsSync(KEYPAIR_PATH)) {
        throw new Error(`Program keypair not found at ${KEYPAIR_PATH}. Run 'anchor build' first.`);
    }

    const keypairData = JSON.parse(readFileSync(KEYPAIR_PATH, "utf8"));
    const programKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    const programId = programKeypair.publicKey.toBase58();

    console.log(`\n2. Program ID: ${programId}`);

    // 3. Deploy to devnet
    console.log("\n3. Deploying to devnet...");
    try {
        execSync(`anchor deploy --provider.cluster devnet`, {
            cwd: SOLANA_DIR,
            stdio: "inherit",
        });
        console.log("Program deployed successfully!");
    } catch (err) {
        // Check if program already deployed
        const connection = new Connection(SOLANA_RPC_URL, "confirmed");
        const accountInfo = await connection.getAccountInfo(new PublicKey(programId));
        if (accountInfo) {
            console.log("Program already deployed, skipping deploy.");
        } else {
            throw err;
        }
    }

    // 4. Update .env with program ID
    updateRootEnv({
        SOLANA_BRIDGE_PROGRAM_ID: programId,
        SOLANA_RPC_URL: SOLANA_RPC_URL,
    });

    // 5. Initialize the bridge (Config, CurrentValue, WormholeEmitter)
    console.log("\n4. Initializing bridge...");
    try {
        await initializeBridge(programId);
        console.log("Bridge initialized successfully!");
    } catch (err: any) {
        if (err.message?.includes("already in use") || err.message?.includes("0x0")) {
            console.log("Bridge already initialized, skipping.");
        } else {
            console.error("Failed to initialize bridge:", err.message);
            throw err;
        }
    }

    // 6. Initialize the counter (for testing)
    console.log("\n5. Initializing counter for testing...");
    try {
        await initializeCounter(programId);
        console.log("Counter initialized successfully!");
    } catch (err: any) {
        if (err.message?.includes("already in use") || err.message?.includes("0x0")) {
            console.log("Counter already initialized, skipping.");
        } else {
            console.error("Failed to initialize counter:", err.message);
        }
    }

    // 7. Print emitter address for registration on other chains
    const { client } = createSolanaClient(SOLANA_RPC_URL, programId);
    const emitterAddress = client.getEmitterAddress();
    const emitterHex = "0x" + Buffer.from(emitterAddress).toString("hex");

    console.log("\n========================================");
    console.log("Deployment complete!");
    console.log(`Program ID: ${programId}`);
    console.log(`Emitter Address: ${emitterHex}`);
    console.log(`Cluster: devnet`);
    console.log("========================================");
    console.log("\nNext steps:");
    console.log("  1. Run 'pnpm run configure:aztec' to register emitters on all chains");
}

async function initializeBridge(programId: string) {
    const { client } = createSolanaClient(SOLANA_RPC_URL, programId);
    const payer = loadKeypair();

    console.log(`  Payer: ${payer.publicKey.toBase58()}`);

    // Check if already initialized
    const isInitialized = await client.isInitialized();
    if (isInitialized) {
        console.log("  Bridge already initialized, skipping.");
        return;
    }

    // Get PDAs for logging
    const pdas = client.getPDAs();
    console.log(`  Config PDA: ${pdas.config.toBase58()}`);
    console.log(`  CurrentValue PDA: ${pdas.currentValue.toBase58()}`);
    console.log(`  WormholeEmitter PDA: ${pdas.wormholeEmitter.toBase58()}`);

    // Initialize the bridge
    const sig = await client.initialize(payer);
    console.log(`  Transaction: ${sig}`);
}

async function initializeCounter(programId: string) {
    // Load wallet from default Solana keypair location
    const walletPath = join(process.env.HOME || "~", ".config/solana/id.json");
    if (!existsSync(walletPath)) {
        throw new Error(`Wallet not found at ${walletPath}. Run 'solana-keygen new' first.`);
    }

    const walletKeypair = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(readFileSync(walletPath, "utf8")))
    );

    // Setup connection and provider
    const connection = new Connection(SOLANA_RPC_URL, "confirmed");
    const wallet = new anchor.Wallet(walletKeypair);
    const provider = new anchor.AnchorProvider(connection, wallet, {
        commitment: "confirmed",
    });
    anchor.setProvider(provider);

    // Load IDL and create program interface
    const idl = JSON.parse(readFileSync(IDL_PATH, "utf8"));
    const program = new anchor.Program(idl, new PublicKey(programId), provider);

    // Derive counter PDA
    const [counterPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("counter")],
        new PublicKey(programId)
    );

    console.log(`  Counter PDA: ${counterPda.toBase58()}`);

    // Check if already initialized
    const counterAccount = await connection.getAccountInfo(counterPda);
    if (counterAccount) {
        console.log("  Counter already exists, skipping initialization.");
        return;
    }

    // Initialize counter
    const tx = await program.methods
        .initializeCounter()
        .accounts({
            payer: walletKeypair.publicKey,
            counter: counterPda,
            systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([walletKeypair])
        .rpc();

    console.log(`  Transaction: ${tx}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
