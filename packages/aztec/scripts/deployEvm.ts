#!/usr/bin/env node
import "dotenv/config";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { updateRootEnv } from "./utils/env";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const EVM_DIR = join(__dirname, "../../evm");
const CHAIN_ID = process.env.EVM_CHAIN_ID || "421614";

const { PRIVATE_KEY } = process.env;
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY not set in .env");

async function main() {
    console.log("Deploying EVM MessageBridge contract...");
    console.log(`  Chain ID: ${CHAIN_ID}`);
    console.log(`  EVM package dir: ${EVM_DIR}`);

    // 1. Deploy using forge
    execSync(
        `forge script script/DeployMessageBridge.s.sol:DeployMessageBridge \
            --rpc-url arbitrum_sepolia \
            --broadcast \
            --private-key ${PRIVATE_KEY}`,
        { cwd: EVM_DIR, stdio: "inherit" }
    );

    // 2. Extract address from broadcast JSON
    const broadcastPath = join(
        EVM_DIR,
        `broadcast/DeployMessageBridge.s.sol/${CHAIN_ID}/run-latest.json`
    );

    console.log(`\nReading broadcast from: ${broadcastPath}`);
    const broadcast = JSON.parse(readFileSync(broadcastPath, "utf8"));

    const deployTx = broadcast.transactions.find(
        (tx: { transactionType: string; contractName: string }) =>
            tx.transactionType === "CREATE" && tx.contractName === "MessageBridge"
    );

    if (!deployTx) {
        throw new Error("Could not find MessageBridge deployment in broadcast");
    }

    const address = deployTx.contractAddress;
    console.log(`\nMessageBridge deployed at: ${address}`);

    // 3. Update root .env
    updateRootEnv({
        EVM_BRIDGE_ADDRESS: address,
    });

    console.log("\nDeployment complete!");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
