#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { TestWallet } from "@aztec/test-wallet/server";
import { MessageBridgeContract, MessageBridgeContractArtifact, WormholeContractArtifact } from "@aztec-wormhole-demo/aztec-contracts/artifacts";
import { loadAccount, getTestnetPxeConfig, testnetSendWaitOpts } from "./utils/aztec";
import { ARBITRUM_SEPOLIA_CHAIN_ID } from "@aztec-wormhole-demo/aztec-contracts/constants";
import { Fr } from "@aztec/aztec.js/fields";

const { AZTEC_NODE_URL, AZTEC_BRIDGE_ADDRESS, AZTEC_WORMHOLE_ADDRESS } = process.env;

if (!AZTEC_NODE_URL) throw new Error("AZTEC_NODE_URL not set in .env");
if (!AZTEC_BRIDGE_ADDRESS)throw new Error("AZTEC_BRIDGE_ADDRESS not set in .env");
if (!AZTEC_WORMHOLE_ADDRESS)throw new Error("AZTEC_WORMHOLE_ADDRESS not set in .env");

type SendMode = "private" | "public";

function parseArgs(): { value: bigint; mode: SendMode } {
    let value = 42n;
    let mode: SendMode = "private"; // default to private

    for (const arg of process.argv.slice(2)) {
        if (arg === "--public") {
            mode = "public";
        } else if (arg === "--private") {
            mode = "private";
        } else if (!arg.startsWith("--")) {
            try {
                value = BigInt(arg);
            } catch {
                // ignore invalid values
            }
        }
    }

    return { value, mode };
}

const main = async () => {
    const { value, mode } = parseArgs();

    const MAX_U128 = 2n ** 128n - 1n;
    if (value < 0n || value > MAX_U128) {
        console.error(`Value must be between 0 and ${MAX_U128}`);
        process.exit(1);
    }

    console.log(`Connecting to Aztec Node at ${AZTEC_NODE_URL}...`);
    const node = createAztecNodeClient(AZTEC_NODE_URL);

    // Create wallet and load account
    const wallet = await TestWallet.create(node, getTestnetPxeConfig());
    const senderAddress = await loadAccount(node, wallet);

    console.log(`Using account: ${senderAddress.toString()}`);

    // Ensure wormhole contract is registered
    const wormholeAddress = AztecAddress.fromString(AZTEC_WORMHOLE_ADDRESS!);
    const contractInstance = await node.getContract(wormholeAddress);
    if (!contractInstance) throw new Error("Aztec wormhole contract not found");
    await wallet.registerContract(contractInstance, WormholeContractArtifact);

    // Ensure bridge contract is registered
    const bridgeAddress = AztecAddress.fromString(AZTEC_BRIDGE_ADDRESS!);
    const instance = await node.getContract(bridgeAddress);
    if (!instance) throw new Error("Aztec bridge contract not found - deploy first");
    await wallet.registerContract(instance, MessageBridgeContractArtifact);
    const bridge = await MessageBridgeContract.at(bridgeAddress, wallet);

    // Send value
    console.log(`Sending value ${value} to EVM (chain ${ARBITRUM_SEPOLIA_CHAIN_ID}) in ${mode.toUpperCase()} mode...`);
    const opts = await testnetSendWaitOpts(node, wallet, senderAddress);
    const feeNonce = Fr.random();

    let receipt;
    if (mode === "public") {
        receipt = await bridge.methods.send_value_public(
            ARBITRUM_SEPOLIA_CHAIN_ID,
            value,
            feeNonce
        ).send(opts.send).wait(opts.wait);
    } else {
        receipt = await bridge.methods.send_value_private(
            ARBITRUM_SEPOLIA_CHAIN_ID,
            value,
            feeNonce
        ).send(opts.send).wait(opts.wait);
    }

    console.log(`Transaction sent! Hash: ${receipt.txHash}`);

    console.log(`\nSource chain explorer: https://devnet.aztecscan.xyz/tx-effects/${receipt.txHash}`);
    console.log(`Wormhole explorer: (Aztec transactions not yet supported on wormholescan)`);

    console.log("\nNext: Wait for the relayer to process this message and deliver it to EVM");
}

main().catch(console.error);
