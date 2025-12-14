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

type ChainName = "arbitrum" | "base";

interface ChainConfig {
    rpcEnvVar: string;
    wormholeAddressEnvVar: string;
    wormholeChainIdEnvVar: string;
    consistencyEnvVar: string;
    bridgeAddressEnvVar: string;
    evmChainId: string;
    verifierUrl: string;
    displayName: string;
}

const CHAIN_CONFIGS: Record<ChainName, ChainConfig> = {
    arbitrum: {
        rpcEnvVar: "ARBITRUM_RPC_URL",
        wormholeAddressEnvVar: "EVM_WORMHOLE_ADDRESS",
        wormholeChainIdEnvVar: "EVM_CHAIN_ID",
        consistencyEnvVar: "EVM_WORMHOLE_CONSISTENCY",
        bridgeAddressEnvVar: "ARBITRUM_BRIDGE_ADDRESS",
        evmChainId: "421614",
        verifierUrl: "https://api.etherscan.io/v2/api?chainid=421614",
        displayName: "Arbitrum Sepolia",
    },
    base: {
        rpcEnvVar: "BASE_RPC_URL",
        wormholeAddressEnvVar: "BASE_WORMHOLE_ADDRESS",
        wormholeChainIdEnvVar: "BASE_CHAIN_ID",
        consistencyEnvVar: "BASE_WORMHOLE_CONSISTENCY",
        bridgeAddressEnvVar: "BASE_BRIDGE_ADDRESS",
        evmChainId: "84532",
        verifierUrl: "https://api.etherscan.io/v2/api?chainid=84532",
        displayName: "Base Sepolia",
    },
};

function parseArgs(): { chains: ChainName[] } {
    const args = process.argv.slice(2);

    if (args.includes("--all")) {
        return { chains: ["arbitrum", "base"] };
    }

    const chainArg = args.find(arg => arg.startsWith("--chain="));
    if (chainArg) {
        const chain = chainArg.split("=")[1] as ChainName;
        if (!CHAIN_CONFIGS[chain]) {
            throw new Error(`Invalid chain: ${chain}. Valid options: arbitrum, base`);
        }
        return { chains: [chain] };
    }

    // Default to arbitrum for backward compatibility
    return { chains: ["arbitrum"] };
}

async function deployToChain(chainName: ChainName) {
    const config = CHAIN_CONFIGS[chainName];

    const rpcUrl = process.env[config.rpcEnvVar];
    const wormholeAddress = process.env[config.wormholeAddressEnvVar];
    const wormholeChainId = process.env[config.wormholeChainIdEnvVar];
    const consistency = process.env[config.consistencyEnvVar];
    const privateKey = process.env.EVM_PRIVATE_KEY;
    const etherscanApiKey = process.env.ETHERSCAN_API_KEY;

    if (!privateKey) throw new Error("EVM_PRIVATE_KEY not set in .env");
    if (!rpcUrl) throw new Error(`${config.rpcEnvVar} not set in .env`);
    if (!wormholeAddress) throw new Error(`${config.wormholeAddressEnvVar} not set in .env`);
    if (!wormholeChainId) throw new Error(`${config.wormholeChainIdEnvVar} not set in .env`);
    if (!consistency) throw new Error(`${config.consistencyEnvVar} not set in .env`);

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Deploying MessageBridge to ${config.displayName}...`);
    console.log(`${"=".repeat(60)}`);
    console.log(`  RPC URL: ${rpcUrl}`);
    console.log(`  Wormhole Chain ID: ${wormholeChainId}`);
    console.log(`  Wormhole Address: ${wormholeAddress}`);
    console.log(`  Consistency: ${consistency}`);
    console.log(`  EVM Chain ID: ${config.evmChainId}`);

    // 1. Deploy using forge, passing env vars
    execSync(
        `forge script script/DeployMessageBridge.s.sol:DeployMessageBridge \
            --rpc-url ${rpcUrl} \
            --broadcast \
            --private-key ${privateKey}`,
        {
            cwd: EVM_DIR,
            stdio: "inherit",
            env: {
                ...process.env,
                // Map to the names expected by the forge script
                WORMHOLE_ADDRESS: wormholeAddress,
                CHAIN_ID: wormholeChainId,
                CONSISTENCY: consistency,
            }
        }
    );

    // 2. Extract address from broadcast JSON
    const broadcastPath = join(
        EVM_DIR,
        `broadcast/DeployMessageBridge.s.sol/${config.evmChainId}/run-latest.json`
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

    // 3. Verify contract if API key is available
    if (etherscanApiKey) {
        console.log(`\nVerifying contract on ${config.displayName}...`);
        try {
            execSync(
                `forge verify-contract ${address} src/MessageBridge.sol:MessageBridge \
                    --chain-id ${config.evmChainId} \
                    --constructor-args $(cast abi-encode "constructor(address,uint16,uint256,uint8)" ${wormholeAddress} ${wormholeChainId} ${config.evmChainId} ${consistency}) \
                    --etherscan-api-key ${etherscanApiKey} \
                    --verifier-url "${config.verifierUrl}" \
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
            console.log(`  cd packages/evm && forge verify-contract ${address} src/MessageBridge.sol:MessageBridge --chain-id ${config.evmChainId} --etherscan-api-key <API_KEY> --verifier-url "${config.verifierUrl}"`);
        }
    } else {
        console.warn("Warning: ETHERSCAN_API_KEY not set - contract verification skipped");
    }

    // 4. Update root .env
    updateRootEnv({
        [config.bridgeAddressEnvVar]: address,
    });

    console.log(`\n${config.displayName} deployment complete!`);
    return address;
}

async function main() {
    const { chains } = parseArgs();

    console.log(`Deploying to: ${chains.join(", ")}`);

    const results: Record<string, string> = {};

    for (const chain of chains) {
        results[chain] = await deployToChain(chain);
    }

    console.log("\n" + "=".repeat(60));
    console.log("Deployment Summary:");
    console.log("=".repeat(60));
    for (const [chain, address] of Object.entries(results)) {
        console.log(`  ${CHAIN_CONFIGS[chain as ChainName].displayName}: ${address}`);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
