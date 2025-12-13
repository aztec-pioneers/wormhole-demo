#!/usr/bin/env node
import { loadRootEnv, updateRootEnv } from "./utils/env";
loadRootEnv();

import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createSolanaClient, loadKeypair } from "./utils/solana";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOLANA_DIR = join(__dirname, "../packages/solana/message_bridge");
const KEYPAIR_PATH = join(SOLANA_DIR, "target/deploy/message_bridge-keypair.json");
const LIB_RS_PATH = join(SOLANA_DIR, "programs/message_bridge/src/lib.rs");
const ANCHOR_TOML_PATH = join(SOLANA_DIR, "Anchor.toml");

// Default to devnet
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

async function main() {
    console.log("Deploying Solana MessageBridge program...");
    console.log(`  RPC URL: ${SOLANA_RPC_URL}`);

    const connection = new Connection(SOLANA_RPC_URL, "confirmed");
    const payer = loadKeypair();
    console.log(`  Payer: ${payer.publicKey.toBase58()}`);

    // 1. Check for existing deployment and close if needed
    const existingProgramId = process.env.SOLANA_BRIDGE_PROGRAM_ID;
    if (existingProgramId) {
        await handleExistingDeployment(connection, existingProgramId, payer);
    }

    // 2. Generate new program keypair
    console.log("\n2. Generating new program keypair...");
    const newProgramId = await generateNewProgramKeypair();
    console.log(`  New Program ID: ${newProgramId}`);

    // 3. Update source files with new program ID
    console.log("\n3. Updating source files with new program ID...");
    updateProgramIdInSources(newProgramId);

    // 4. Build the program
    console.log("\n4. Building program...");
    execSync("anchor build", {
        cwd: SOLANA_DIR,
        stdio: "inherit",
    });

    // 5. Deploy to devnet
    console.log("\n5. Deploying to devnet...");
    execSync(`anchor deploy --provider.cluster devnet`, {
        cwd: SOLANA_DIR,
        stdio: "inherit",
    });
    console.log("Program deployed successfully!");

    // 6. Update .env with new program ID
    updateRootEnv({
        SOLANA_BRIDGE_PROGRAM_ID: newProgramId,
        SOLANA_RPC_URL: SOLANA_RPC_URL,
    });

    // 7. Initialize the bridge
    console.log("\n6. Initializing bridge...");
    await initializeBridge(newProgramId);
    console.log("Bridge initialized successfully!");

    // 8. Print summary
    const { client } = createSolanaClient(SOLANA_RPC_URL, newProgramId);
    const emitterAddress = client.getEmitterAddress();
    const emitterHex = "0x" + Buffer.from(emitterAddress).toString("hex");

    console.log("\n========================================");
    console.log("Deployment complete!");
    console.log(`Program ID: ${newProgramId}`);
    console.log(`Emitter Address: ${emitterHex}`);
    console.log(`Cluster: devnet`);
    console.log("========================================");
    console.log("\nNext steps:");
    console.log("  1. Run 'pnpm register-emitters' to register emitters on all chains");
}

async function handleExistingDeployment(connection: Connection, programId: string, payer: Keypair) {
    console.log(`\n1. Checking existing deployment: ${programId}`);

    try {
        const pubkey = new PublicKey(programId);
        const accountInfo = await connection.getAccountInfo(pubkey);

        if (!accountInfo) {
            console.log("  No existing deployment found (account doesn't exist).");
            return;
        }

        if (!accountInfo.executable) {
            console.log("  Account exists but is not executable (already closed or not a program).");
            return;
        }

        // Program exists and is executable - close it
        console.log("  Found existing deployment. Closing to recover rent...");
        const balanceBefore = await connection.getBalance(payer.publicKey);

        try {
            execSync(
                `solana program close ${programId} --bypass-warning`,
                { stdio: "inherit" }
            );

            const balanceAfter = await connection.getBalance(payer.publicKey);
            const recovered = (balanceAfter - balanceBefore) / 1e9;
            console.log(`  Recovered ${recovered.toFixed(4)} SOL`);
        } catch (err: any) {
            // Program might already be closed or we don't have authority
            console.log(`  Could not close program: ${err.message}`);
        }
    } catch (err: any) {
        console.log(`  Error checking existing deployment: ${err.message}`);
    }
}

async function generateNewProgramKeypair(): Promise<string> {
    // Remove old keypair if it exists
    if (existsSync(KEYPAIR_PATH)) {
        unlinkSync(KEYPAIR_PATH);
    }

    // Generate new keypair
    execSync(
        `solana-keygen new -o "${KEYPAIR_PATH}" --no-bip39-passphrase --force`,
        { stdio: "pipe" }
    );

    // Read the new keypair and get the public key
    const keypairData = JSON.parse(readFileSync(KEYPAIR_PATH, "utf8"));
    const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    return keypair.publicKey.toBase58();
}

function updateProgramIdInSources(newProgramId: string) {
    // Update lib.rs
    let libRs = readFileSync(LIB_RS_PATH, "utf8");
    libRs = libRs.replace(
        /declare_id!\("[^"]+"\);/,
        `declare_id!("${newProgramId}");`
    );
    writeFileSync(LIB_RS_PATH, libRs);
    console.log(`  Updated lib.rs`);

    // Update Anchor.toml
    let anchorToml = readFileSync(ANCHOR_TOML_PATH, "utf8");
    anchorToml = anchorToml.replace(
        /message_bridge = "[^"]+"/,
        `message_bridge = "${newProgramId}"`
    );
    writeFileSync(ANCHOR_TOML_PATH, anchorToml);
    console.log(`  Updated Anchor.toml`);
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

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
