#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { TestWallet } from "@aztec/test-wallet/server";
import { MessageBridgeContract, MessageBridgeContractArtifact, WormholeContractArtifact } from "../ts/artifacts";
import { loadAccounts, getTestnetPxeConfig, testnetSendWaitOpts } from "./utils/aztec";
import { ARBITRUM_SEPOLIA_CHAIN_ID } from "../ts/constants";
import { Fr } from "@aztec/aztec.js/fields";

const { AZTEC_NODE_URL, AZTEC_BRIDGE_ADDRESS, AZTEC_WORMHOLE_ADDRESS } = process.env;

if (!AZTEC_NODE_URL) throw new Error("AZTEC_NODE_URL not set in .env");
if (!AZTEC_BRIDGE_ADDRESS)throw new Error("AZTEC_BRIDGE_ADDRESS not set in .env");
if (!AZTEC_WORMHOLE_ADDRESS)throw new Error("AZTEC_WORMHOLE_ADDRESS not set in .env");

type SendMode = "private" | "public";

function parseArgs(): { value: number; mode: SendMode } {
    let value = 42;
    let mode: SendMode = "private"; // default to private

    for (const arg of process.argv.slice(2)) {
        if (arg === "--public") {
            mode = "public";
        } else if (arg === "--private") {
            mode = "private";
        } else if (!arg.startsWith("--")) {
            const parsed = parseInt(arg);
            if (!isNaN(parsed)) {
                value = parsed;
            }
        }
    }

    return { value, mode };
}

const main = async () => {
    const { value, mode } = parseArgs();

    if (value < 0 || value > 255) {
        console.error("Value must be between 0 and 255");
        process.exit(1);
    }

    console.log(`Connecting to Aztec Node at ${AZTEC_NODE_URL}...`);
    const node = createAztecNodeClient(AZTEC_NODE_URL);

    // Create wallet and load accounts
    const wallet = await TestWallet.create(node, getTestnetPxeConfig());
    const [senderAddress] = await loadAccounts(node, wallet);

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
    console.log("\nNext: Wait for the relayer to process this message and deliver it to EVM");
}

main().catch(console.error);
