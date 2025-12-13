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

const EVM_DIR = join(__dirname, "../packages/evm");

const {
    EVM_PRIVATE_KEY,
    ARBITRUM_RPC_URL,
    EVM_WORMHOLE_ADDRESS,
    EVM_CHAIN_ID,
    EVM_WORMHOLE_CONSISTENCY,
    ETHERSCAN_API_KEY
} = process.env;

if (!EVM_PRIVATE_KEY) throw new Error("EVM_PRIVATE_KEY not set in .env");
if (!ARBITRUM_RPC_URL) throw new Error("ARBITRUM_RPC_URL not set in .env");
if (!EVM_WORMHOLE_ADDRESS) throw new Error("EVM_WORMHOLE_ADDRESS not set in .env");
if (!EVM_CHAIN_ID) throw new Error("EVM_CHAIN_ID not set in .env");
if (!EVM_WORMHOLE_CONSISTENCY) throw new Error("EVM_WORMHOLE_CONSISTENCY not set in .env");
if (!ETHERSCAN_API_KEY) console.warn("Warning: ETHERSCAN_API_KEY not set - contract verification will be skipped");

async function main() {
    console.log("Deploying EVM MessageBridge contract...");
    console.log(`  RPC URL: ${ARBITRUM_RPC_URL}`);
    console.log(`  Wormhole Chain ID: ${EVM_CHAIN_ID}`);
    console.log(`  Wormhole Address: ${EVM_WORMHOLE_ADDRESS}`);
    console.log(`  Consistency: ${EVM_WORMHOLE_CONSISTENCY}`);

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
                CONSISTENCY: EVM_WORMHOLE_CONSISTENCY,
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

    // 3. Verify contract on Arbiscan if API key is available
    if (ETHERSCAN_API_KEY) {
        console.log("\nVerifying contract on Arbiscan...");
        try {
            // Construct constructor args for verification
            // Constructor: (address wormholeAddr, uint16 chainId_, uint256 evmChainId_, uint8 consistency_)
            execSync(
                `forge verify-contract ${address} src/MessageBridge.sol:MessageBridge \
                    --chain-id 421614 \
                    --constructor-args $(cast abi-encode "constructor(address,uint16,uint256,uint8)" ${EVM_WORMHOLE_ADDRESS} ${EVM_CHAIN_ID} 421614 ${EVM_WORMHOLE_CONSISTENCY}) \
                    --etherscan-api-key ${ETHERSCAN_API_KEY} \
                    --verifier-url "https://api.etherscan.io/v2/api?chainid=421614" \
                    --watch`,
                {
                    cwd: EVM_DIR,
                    stdio: "inherit",
                    env: process.env
                }
            );
            console.log("Contract verified successfully!");
        } catch (err) {
            console.error("Contract verification failed:", err);
            console.log("You can manually verify later using:");
            console.log(`  cd packages/evm && forge verify-contract ${address} src/MessageBridge.sol:MessageBridge --chain-id 421614 --etherscan-api-key <API_KEY> --verifier-url "https://api.etherscan.io/v2/api?chainid=421614"`);
        }
    }

    // 4. Update root .env
    updateRootEnv({
        EVM_BRIDGE_ADDRESS: address,
    });

    console.log("\nDeployment complete!");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
