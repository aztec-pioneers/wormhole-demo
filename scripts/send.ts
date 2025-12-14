#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();

import {
    createEvmClient,
    createAztecClient,
    createSolanaClient,
    type EvmChainName,
} from "./utils/clients";
import { BaseMessageBridgeEmitter } from "../packages/shared/src/messageBridge";
import {
    AVAILABLE_NETWORKS,
    EXPLORERS,
    MAX_U128,
    NetworkName,
    WORMHOLE_CHAIN_IDS
} from "@aztec-wormhole-demo/shared";


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

function parseArgs(): { value: bigint; from: NetworkName; to: NetworkName } {
    const args = process.argv.slice(2);
    if (args.includes("--help") || args.includes("-h")) showHelp();

    let value: bigint | undefined;
    let from: NetworkName | undefined;
    let to: NetworkName | undefined;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--from") {
            const next = args[++i];
            if (!AVAILABLE_NETWORKS.includes(next as NetworkName))
                showHelp(`Invalid source: "${next}"`);
            from = next as NetworkName;
        } else if (arg === "--to") {
            const next = args[++i];
            if (!AVAILABLE_NETWORKS.includes(next as NetworkName))
                showHelp(`Invalid destination: "${next}"`);
            to = next as NetworkName;
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
    const destinationChainId = WORMHOLE_CHAIN_IDS[to];

    console.log(`Cross-chain value transfer`);
    console.log(`  Value: ${value}`);
    console.log(`  From: ${from} → To: ${to} (chain ID: ${destinationChainId})`);

    // set the client
    let client: BaseMessageBridgeEmitter;
    if (from === "aztec")  client = await createAztecClient();
    else if (from === "solana") client = await createSolanaClient();
    else client = await createEvmClient(from as EvmChainName);
    console.log(`Connected using ${client.chainName} client...`);
    const txHash = await client.sendValue(destinationChainId, value);

    console.log(`\nTransaction: ${txHash}`);
    console.log(`\nExplorer: ${EXPLORERS[from].txUrl(txHash)}`);
    if (from !== "aztec")
        console.log(`Wormhole: https://wormholescan.io/#/tx/${txHash}?network=Testnet`);
    else console.log("Wormhole: (not available for Aztec)");
    console.log(`\nNext: Wait for the relayer to deliver VAA to ${to}`);
}

main().catch((err) => {
    console.error(`\nFailed: ${err.message}`);
    process.exit(1);
});
