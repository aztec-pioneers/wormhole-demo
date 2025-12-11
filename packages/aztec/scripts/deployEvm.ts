#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { updateRootEnv } from "./utils/env";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const EVM_DIR = join(__dirname, "../../evm");

const {
    EVM_PRIVATE_KEY,
    ARBITRUM_RPC_URL,
    EVM_WORMHOLE_ADDRESS,
    EVM_CHAIN_ID,
    EVM_FINALITY
} = process.env;

if (!EVM_PRIVATE_KEY) throw new Error("EVM_PRIVATE_KEY not set in .env");
if (!ARBITRUM_RPC_URL) throw new Error("ARBITRUM_RPC_URL not set in .env");
if (!EVM_WORMHOLE_ADDRESS) throw new Error("EVM_WORMHOLE_ADDRESS not set in .env");
if (!EVM_CHAIN_ID) throw new Error("EVM_CHAIN_ID not set in .env");
if (!EVM_FINALITY) throw new Error("EVM_FINALITY not set in .env");

async function main() {
    console.log("Deploying EVM MessageBridge contract...");
    console.log(`  RPC URL: ${ARBITRUM_RPC_URL}`);
    console.log(`  Wormhole Chain ID: ${EVM_CHAIN_ID}`);
    console.log(`  Wormhole Address: ${EVM_WORMHOLE_ADDRESS}`);
    console.log(`  Finality: ${EVM_FINALITY}`);

    // 1. Deploy using forge, passing env vars
    execSync(
        `forge script script/DeployMessageBridge.s.sol:DeployMessageBridge \
            --rpc-url ${ARBITRUM_RPC_URL} \
            --broadcast \
            --private-key ${EVM_PRIVATE_KEY}`,
        {
            cwd: EVM_DIR,
            stdio: "inherit",
            env: {
                ...process.env,
                // Map to the names expected by the forge script
                WORMHOLE_ADDRESS: EVM_WORMHOLE_ADDRESS,
                CHAIN_ID: EVM_CHAIN_ID,
                FINALITY: EVM_FINALITY,
            }
        }
    );

    // 2. Extract address from broadcast JSON
    // Note: Forge uses the actual EVM chain ID (421614 for Arbitrum Sepolia), not Wormhole chain ID
    const evmChainId = "421614";
    const broadcastPath = join(
        EVM_DIR,
        `broadcast/DeployMessageBridge.s.sol/${evmChainId}/run-latest.json`
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
