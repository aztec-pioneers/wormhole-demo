#!/usr/bin/env node
import { loadRootEnv, updateRootEnv } from "./utils/env";
loadRootEnv();

import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createSolanaClient } from "./utils/solana";
import { loadKeypair } from "./utils/solana";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SOLANA_DIR = join(__dirname, "../packages/solana/message_bridge");
const KEYPAIR_PATH = join(SOLANA_DIR, "target/deploy/message_bridge-keypair.json");
const LIB_RS_PATH = join(SOLANA_DIR, "programs/message_bridge/src/lib.rs");
const ANCHOR_TOML_PATH = join(SOLANA_DIR, "Anchor.toml");

const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

async function main() {
    console.log("Deploying Solana MessageBridge program...");
    console.log(`  RPC URL: ${SOLANA_RPC_URL}`);

    const connection = new Connection(SOLANA_RPC_URL, "confirmed");
    const payer = loadKeypair();
    console.log(`  Payer: ${payer.publicKey.toBase58()}`);

    // 1. Check for existing deployment
    const existingProgramId = process.env.SOLANA_BRIDGE_PROGRAM_ID;
    if (existingProgramId) {
        await handleExistingDeployment(connection, existingProgramId, payer);
    }

    // 2. Generate new program keypair
    console.log("\n2. Generating new program keypair...");
    const newProgramId = generateNewProgramKeypair();
    console.log(`  New Program ID: ${newProgramId}`);

    // 3. Update source files
    console.log("\n3. Updating source files...");
    updateProgramIdInSources(newProgramId);

    // 4. Build
    console.log("\n4. Building program...");
    execSync("anchor build", { cwd: SOLANA_DIR, stdio: "inherit" });

    // 5. Deploy
    console.log("\n5. Deploying to devnet...");
    execSync("anchor deploy --provider.cluster devnet", { cwd: SOLANA_DIR, stdio: "inherit" });

    // 6. Update .env
    updateRootEnv({ SOLANA_BRIDGE_PROGRAM_ID: newProgramId, SOLANA_RPC_URL });

    // 7. Initialize
    console.log("\n6. Initializing bridge...");
    await initializeBridge(newProgramId, payer);

    // 8. Summary
    const { client } = await createSolanaClient(SOLANA_RPC_URL, newProgramId, payer);
    console.log("\n========================================");
    console.log("Deployment complete!");
    console.log(`Program ID: ${newProgramId}`);
    console.log(`Emitter: ${client.getEmitterAddress()}`);
    console.log("========================================");
    console.log("\nRun 'pnpm register-emitters' to register emitters");
}

async function handleExistingDeployment(connection: Connection, programId: string, payer: Keypair) {
    console.log(`\n1. Checking existing deployment: ${programId}`);
    try {
        const accountInfo = await connection.getAccountInfo(new PublicKey(programId));
        if (accountInfo?.executable) {
            console.log("  Found existing deployment. Closing...");
            const before = await connection.getBalance(payer.publicKey);
            try {
                execSync(`solana program close ${programId} --bypass-warning`, { stdio: "inherit" });
                const after = await connection.getBalance(payer.publicKey);
                console.log(`  Recovered ${((after - before) / 1e9).toFixed(4)} SOL`);
            } catch { console.log("  Could not close program"); }
        }
    } catch { }
}

function generateNewProgramKeypair(): string {
    if (existsSync(KEYPAIR_PATH)) unlinkSync(KEYPAIR_PATH);
    execSync(`solana-keygen new -o "${KEYPAIR_PATH}" --no-bip39-passphrase --force`, { stdio: "pipe" });
    const keypairData = JSON.parse(readFileSync(KEYPAIR_PATH, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(keypairData)).publicKey.toBase58();
}

function updateProgramIdInSources(newProgramId: string) {
    let libRs = readFileSync(LIB_RS_PATH, "utf8");
    libRs = libRs.replace(/declare_id!\("[^"]+"\);/, `declare_id!("${newProgramId}");`);
    writeFileSync(LIB_RS_PATH, libRs);

    let anchorToml = readFileSync(ANCHOR_TOML_PATH, "utf8");
    anchorToml = anchorToml.replace(/message_bridge = "[^"]+"/, `message_bridge = "${newProgramId}"`);
    writeFileSync(ANCHOR_TOML_PATH, anchorToml);
}

async function initializeBridge(programId: string, payer: Keypair) {
    const client = await createClient(programId, payer);
    if (await client.isInitialized()) {
        console.log("  Already initialized");
        return;
    }
    const pdas = client.getPDAs();
    console.log(`  Config PDA: ${pdas.config.toBase58()}`);
    const sig = await client.initialize();
    console.log(`  Transaction: ${sig}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
