#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { TestWallet } from "@aztec/test-wallet/server";
import { MessageBridgeContract, MessageBridgeContractArtifact, WormholeContractArtifact } from "@aztec-wormhole-demo/aztec-contracts/artifacts";
import { loadAccount, getTestnetPxeConfig, testnetSendWaitOpts } from "./utils/aztec";
import { createEvmClients, MESSAGE_BRIDGE_ABI, EvmChainName } from "./utils/evm";
import { createSolanaClient, loadKeypair } from "./utils/solana";
import { getAddress } from "viem";
import { Fr } from "@aztec/aztec.js/fields";
import {
    CHAIN_ID_SOLANA,
    CHAIN_ID_ARBITRUM_SEPOLIA,
    CHAIN_ID_BASE_SEPOLIA,
    CHAIN_ID_AZTEC,
} from "@aztec-wormhole-demo/solana-sdk";

// Valid chain names
const VALID_CHAINS = ["arbitrum", "base", "solana", "aztec"] as const;
type ChainName = typeof VALID_CHAINS[number];

// Chain name to Wormhole chain ID mapping
const CHAIN_IDS: Record<ChainName, number> = {
    arbitrum: CHAIN_ID_ARBITRUM_SEPOLIA,
    base: CHAIN_ID_BASE_SEPOLIA,
    solana: CHAIN_ID_SOLANA,
    aztec: CHAIN_ID_AZTEC,
};

// Environment variables
const {
    AZTEC_NODE_URL,
    AZTEC_BRIDGE_ADDRESS,
    AZTEC_WORMHOLE_ADDRESS,
    ARBITRUM_RPC_URL,
    BASE_RPC_URL,
    EVM_PRIVATE_KEY,
    ARBITRUM_BRIDGE_ADDRESS,
    BASE_BRIDGE_ADDRESS,
    SOLANA_RPC_URL,
    SOLANA_BRIDGE_PROGRAM_ID,
} = process.env;

// Wormhole ABI for message fee
const WORMHOLE_ABI = [
    {
        name: "messageFee",
        type: "function",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "uint256" }],
    },
] as const;

const MAX_U128 = 2n ** 128n - 1n;

function showHelp(error?: string) {
    if (error) {
        console.error(`Error: ${error}\n`);
    }
    console.log(`Usage: pnpm send <value> --from <source> --to <destination>

Arguments:
  <value>                  The value to send (must be a valid u128: 0 to ${MAX_U128})

Options:
  --from <source>          Source chain (required): arbitrum | base | solana | aztec
  --to <destination>       Destination chain (required): arbitrum | base | solana | aztec
  --public                 Use public mode for Aztec (default: private)
  --help                   Show this help message

Examples:
  pnpm send 42 --from arbitrum --to aztec
  pnpm send 100 --from aztec --to base
  pnpm send 1000 --from solana --to arbitrum --public

Notes:
  - Source and destination must be different chains
  - Aztec sends default to private mode unless --public is specified
`);
    process.exit(error ? 1 : 0);
}

function parseArgs(): { value: bigint; from: ChainName; to: ChainName; mode: "private" | "public" } {
    const args = process.argv.slice(2);

    if (args.includes("--help") || args.includes("-h")) {
        showHelp();
    }

    let value: bigint | undefined;
    let from: ChainName | undefined;
    let to: ChainName | undefined;
    let mode: "private" | "public" = "private";

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === "--from") {
            const next = args[++i];
            if (!next) showHelp("--from requires a value");
            if (!VALID_CHAINS.includes(next as ChainName)) {
                showHelp(`Invalid source chain: "${next}". Must be one of: ${VALID_CHAINS.join(", ")}`);
            }
            from = next as ChainName;
        } else if (arg === "--to") {
            const next = args[++i];
            if (!next) showHelp("--to requires a value");
            if (!VALID_CHAINS.includes(next as ChainName)) {
                showHelp(`Invalid destination chain: "${next}". Must be one of: ${VALID_CHAINS.join(", ")}`);
            }
            to = next as ChainName;
        } else if (arg === "--public") {
            mode = "public";
        } else if (arg === "--private") {
            mode = "private";
        } else if (!arg.startsWith("--")) {
            try {
                value = BigInt(arg);
            } catch {
                showHelp(`Invalid value: "${arg}". Must be a valid integer.`);
            }
        }
    }

    // Validate required arguments
    if (value === undefined) {
        showHelp("Missing required argument: <value>");
    }
    if (!from) {
        showHelp("Missing required option: --from <source>");
    }
    if (!to) {
        showHelp("Missing required option: --to <destination>");
    }

    // Validate value range
    if (value < 0n || value > MAX_U128) {
        showHelp(`Value out of range. Must be between 0 and ${MAX_U128}`);
    }

    // Validate source != destination
    if (from === to) {
        showHelp(`Source and destination cannot be the same chain: "${from}"`);
    }

    return { value: value!, from: from!, to: to!, mode };
}

// ============================================================
// SEND FROM EVM (ARBITRUM or BASE)
// ============================================================

async function sendFromEvm(
    chainName: EvmChainName,
    rpcUrl: string,
    bridgeAddress: string,
    displayName: string,
    explorerUrl: string,
    destinationChainId: number,
    value: bigint,
    destinationName: string
) {
    if (!EVM_PRIVATE_KEY) throw new Error("EVM_PRIVATE_KEY not set in .env");

    console.log(`\nConnecting to ${displayName}...`);
    const { account, publicClient, walletClient } = createEvmClients(rpcUrl, EVM_PRIVATE_KEY, chainName);
    const bridge = getAddress(bridgeAddress);

    console.log(`  Account: ${account.address}`);
    console.log(`  Bridge: ${bridge}`);

    // Get Wormhole message fee
    const wormholeAddress = await publicClient.readContract({
        address: bridge,
        abi: MESSAGE_BRIDGE_ABI,
        functionName: "WORMHOLE",
    }) as `0x${string}`;

    const messageFee = await publicClient.readContract({
        address: wormholeAddress,
        abi: WORMHOLE_ABI,
        functionName: "messageFee",
    }) as bigint;

    console.log(`  Wormhole fee: ${messageFee} wei`);

    console.log(`\nSending value ${value} to ${destinationName} (chain ${destinationChainId})...`);

    const hash = await walletClient.writeContract({
        address: bridge,
        abi: MESSAGE_BRIDGE_ABI,
        functionName: "sendValue",
        args: [destinationChainId, value],
        value: messageFee,
    });

    console.log(`  Transaction submitted: ${hash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  Confirmed in block ${receipt.blockNumber}`);

    console.log(`\nExplorer links:`);
    console.log(`  ${displayName}: ${explorerUrl}/tx/${hash}`);
    console.log(`  Wormhole: https://wormholescan.io/#/tx/${hash}?network=Testnet`);
}

async function sendFromArbitrum(destinationChainId: number, value: bigint, destinationName: string) {
    if (!ARBITRUM_RPC_URL) throw new Error("ARBITRUM_RPC_URL not set in .env");
    if (!ARBITRUM_BRIDGE_ADDRESS) throw new Error("ARBITRUM_BRIDGE_ADDRESS not set in .env");

    await sendFromEvm(
        "arbitrum",
        ARBITRUM_RPC_URL,
        ARBITRUM_BRIDGE_ADDRESS,
        "Arbitrum Sepolia",
        "https://sepolia.arbiscan.io",
        destinationChainId,
        value,
        destinationName
    );
}

async function sendFromBase(destinationChainId: number, value: bigint, destinationName: string) {
    if (!BASE_RPC_URL) throw new Error("BASE_RPC_URL not set in .env");
    if (!BASE_BRIDGE_ADDRESS) throw new Error("BASE_BRIDGE_ADDRESS not set in .env");

    await sendFromEvm(
        "base",
        BASE_RPC_URL,
        BASE_BRIDGE_ADDRESS,
        "Base Sepolia",
        "https://sepolia.basescan.org",
        destinationChainId,
        value,
        destinationName
    );
}

// ============================================================
// SEND FROM AZTEC
// ============================================================

async function sendFromAztec(destinationChainId: number, value: bigint, destinationName: string, mode: "private" | "public") {
    if (!AZTEC_NODE_URL) throw new Error("AZTEC_NODE_URL not set in .env");
    if (!AZTEC_BRIDGE_ADDRESS) throw new Error("AZTEC_BRIDGE_ADDRESS not set in .env");
    if (!AZTEC_WORMHOLE_ADDRESS) throw new Error("AZTEC_WORMHOLE_ADDRESS not set in .env");

    console.log(`\nConnecting to Aztec...`);
    const node = createAztecNodeClient(AZTEC_NODE_URL);
    const wallet = await TestWallet.create(node, getTestnetPxeConfig());
    const senderAddress = await loadAccount(node, wallet);

    console.log(`  Account: ${senderAddress.toString()}`);

    // Register contracts
    const wormholeAddress = AztecAddress.fromString(AZTEC_WORMHOLE_ADDRESS);
    const wormholeInstance = await node.getContract(wormholeAddress);
    if (!wormholeInstance) throw new Error("Aztec wormhole contract not found");
    await wallet.registerContract(wormholeInstance, WormholeContractArtifact);

    const bridgeAddress = AztecAddress.fromString(AZTEC_BRIDGE_ADDRESS);
    const bridgeInstance = await node.getContract(bridgeAddress);
    if (!bridgeInstance) throw new Error("Aztec bridge contract not found");
    await wallet.registerContract(bridgeInstance, MessageBridgeContractArtifact);

    console.log(`  Bridge: ${AZTEC_BRIDGE_ADDRESS}`);

    const bridge = await MessageBridgeContract.at(bridgeAddress, wallet);
    const opts = await testnetSendWaitOpts(node, wallet, senderAddress);
    const feeNonce = Fr.random();

    console.log(`\nSending value ${value} to ${destinationName} (chain ${destinationChainId}) in ${mode.toUpperCase()} mode...`);

    let receipt;
    if (mode === "public") {
        receipt = await bridge.methods.send_value_public(
            destinationChainId,
            value,
            feeNonce
        ).send(opts.send).wait(opts.wait);
    } else {
        receipt = await bridge.methods.send_value_private(
            destinationChainId,
            value,
            feeNonce
        ).send(opts.send).wait(opts.wait);
    }

    console.log(`  Transaction hash: ${receipt.txHash}`);

    console.log(`\nExplorer links:`);
    console.log(`  Aztec: https://devnet.aztecscan.xyz/tx-effects/${receipt.txHash}`);
    console.log(`  Wormhole: (Aztec transactions not yet supported on wormholescan)`);
}

// ============================================================
// SEND FROM SOLANA
// ============================================================

async function sendFromSolana(destinationChainId: number, value: bigint, destinationName: string) {
    if (!SOLANA_RPC_URL) throw new Error("SOLANA_RPC_URL not set in .env");
    if (!SOLANA_BRIDGE_PROGRAM_ID) throw new Error("SOLANA_BRIDGE_PROGRAM_ID not set in .env");

    console.log(`\nConnecting to Solana Devnet...`);
    const { client } = createSolanaClient(SOLANA_RPC_URL, SOLANA_BRIDGE_PROGRAM_ID);
    const payer = loadKeypair();

    console.log(`  Account: ${payer.publicKey.toBase58()}`);
    console.log(`  Program: ${SOLANA_BRIDGE_PROGRAM_ID}`);

    // Check if initialized
    const isInitialized = await client.isInitialized();
    if (!isInitialized) {
        throw new Error("Solana bridge not initialized. Run 'pnpm deploy:solana' first.");
    }

    console.log(`\nSending value ${value} to ${destinationName} (chain ${destinationChainId})...`);

    const result = await client.sendValue(payer, destinationChainId, value);

    console.log(`  Transaction: ${result.signature}`);
    console.log(`  Nonce: ${result.nonce}`);
    console.log(`  Message Key: ${result.messageKey.toBase58()}`);

    console.log(`\nExplorer links:`);
    console.log(`  Solana: https://explorer.solana.com/tx/${result.signature}?cluster=devnet`);
    console.log(`  Wormhole: https://wormholescan.io/#/tx/${result.signature}?network=Testnet`);
}

// ============================================================
// MAIN
// ============================================================

async function main() {
    const { value, from, to, mode } = parseArgs();
    const destinationChainId = CHAIN_IDS[to];

    console.log(`Cross-chain value transfer`);
    console.log(`  Value: ${value}`);
    console.log(`  From: ${from}`);
    console.log(`  To: ${to} (chain ID: ${destinationChainId})`);

    switch (from) {
        case "arbitrum":
            await sendFromArbitrum(destinationChainId, value, to);
            break;
        case "base":
            await sendFromBase(destinationChainId, value, to);
            break;
        case "aztec":
            await sendFromAztec(destinationChainId, value, to, mode);
            break;
        case "solana":
            await sendFromSolana(destinationChainId, value, to);
            break;
    }

    console.log(`\nNext: Wait for the relayer to process this message and deliver it to ${to}`);
}

main().catch((err) => {
    console.error(`\nFailed: ${err.message}`);
    process.exit(1);
});
