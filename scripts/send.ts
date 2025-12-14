#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();

import {
    WORMHOLE_CHAIN_ID_SOLANA,
    WORMHOLE_CHAIN_ID_ARBITRUM_SEPOLIA,
    WORMHOLE_CHAIN_ID_BASE_SEPOLIA,
    WORMHOLE_CHAIN_ID_AZTEC,
} from "@aztec-wormhole-demo/shared";
import { EvmMessageBridgeClient } from "@aztec-wormhole-demo/evm-sdk";
import { AztecMessageBridgeClient } from "@aztec-wormhole-demo/aztec-contracts";
import { SolanaMessageBridgeClient } from "@aztec-wormhole-demo/solana-sdk";
import {
    createEvmClient,
    createAztecClient,
    createSolanaClient,
    type EvmChainName,
} from "./utils/clients";
import { BaseMessageBridgeClient } from "../packages/shared/src/messageBridge";

// Valid chain names
const VALID_CHAINS = ["arbitrum", "base", "solana", "aztec"] as const;
type ChainName = typeof VALID_CHAINS[number];

const CHAIN_IDS: Record<ChainName, number> = {
    arbitrum: WORMHOLE_CHAIN_ID_ARBITRUM_SEPOLIA,
    base: WORMHOLE_CHAIN_ID_BASE_SEPOLIA,
    solana: WORMHOLE_CHAIN_ID_SOLANA,
    aztec: WORMHOLE_CHAIN_ID_AZTEC,
};

const EXPLORERS: Record<ChainName, { name: string; txUrl: (hash: string) => string }> = {
    arbitrum: { name: "Arbiscan", txUrl: h => `https://sepolia.arbiscan.io/tx/${h}` },
    base: { name: "Basescan", txUrl: h => `https://sepolia.basescan.org/tx/${h}` },
    solana: { name: "Solana Explorer", txUrl: h => `https://explorer.solana.com/tx/${h}?cluster=devnet` },
    aztec: { name: "Aztecscan", txUrl: h => `https://devnet.aztecscan.xyz/tx-effects/${h}` },
};

const MAX_U128 = 2n ** 128n - 1n;

function showHelp(error?: string) {
    if (error) console.error(`Error: ${error}\n`);
    console.log(`Usage: pnpm send <value> --from <source> --to <destination>

Arguments:
  <value>                  The value to send (must be a valid u128)

Options:
  --from <source>          Source chain: arbitrum | base | solana | aztec
  --to <destination>       Destination chain: arbitrum | base | solana | aztec
  --public                 Use public mode for Aztec (default: private)
  --help                   Show this help message

Examples:
  pnpm send 42 --from arbitrum --to aztec
  pnpm send 100 --from aztec --to base --public
`);
    process.exit(error ? 1 : 0);
}

function parseArgs(): { value: bigint; from: ChainName; to: ChainName } {
    const args = process.argv.slice(2);
    if (args.includes("--help") || args.includes("-h")) showHelp();

    let value: bigint | undefined;
    let from: ChainName | undefined;
    let to: ChainName | undefined;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--from") {
            const next = args[++i];
            if (!VALID_CHAINS.includes(next as ChainName)) showHelp(`Invalid source: "${next}"`);
            from = next as ChainName;
        } else if (arg === "--to") {
            const next = args[++i];
            if (!VALID_CHAINS.includes(next as ChainName)) showHelp(`Invalid destination: "${next}"`);
            to = next as ChainName;
        } else if (!arg.startsWith("--")) {
            try { value = BigInt(arg); } catch { showHelp(`Invalid value: "${arg}"`); }
        }
    }

    if (value === undefined) showHelp("Missing <value>");
    if (!from) showHelp("Missing --from");
    if (!to) showHelp("Missing --to");
    if (value! < 0n || value! > MAX_U128) showHelp("Value out of range");
    if (from === to) showHelp("Source and destination cannot be the same");

    return { value: value!, from: from!, to: to! };
}

async function main() {
    const { value, from, to } = parseArgs();
    const destinationChainId = CHAIN_IDS[to];

    console.log(`Cross-chain value transfer`);
    console.log(`  Value: ${value}`);
    console.log(`  From: ${from} → To: ${to} (chain ID: ${destinationChainId})`);

    // set the client
    let client: BaseMessageBridgeClient;
    if (from === "aztec")  client = await createAztecClient();
    else if (from === "solana") client = await createSolanaClient();
    else client = await createEvmClient(from as EvmChainName);
    console.log(`Connected using ${client.chainName} client...`);
    const txHash = await client.sendValue(destinationChainId, value);

    console.log(`\nTransaction: ${txHash}`);
    console.log(`\nExplorer: ${EXPLORERS[from].txUrl(txHash)}`);
    console.log(`Wormhole: https://wormholescan.io/#/tx/${txHash}?network=Testnet`);
    console.log(`\nNext: Wait for the relayer to deliver to ${to}`);
}

main().catch((err) => {
    console.error(`\nFailed: ${err.message}`);
    process.exit(1);
});
