#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { TestWallet } from "@aztec/test-wallet/server";
import { MessageBridgeContract, MessageBridgeContractArtifact } from "../ts/artifacts";
import { loadAccounts, getTestnetPxeConfig, testnetSendWaitOpts } from "./utils/aztec";
import { ARBITRUM_SEPOLIA_CHAIN_ID } from "../ts/constants";
import { Fr } from "@aztec/aztec.js/fields";

const { AZTEC_NODE_URL, AZTEC_BRIDGE_ADDRESS } = process.env;

if (!AZTEC_NODE_URL) throw new Error("AZTEC_NODE_URL not set in .env");
if (!AZTEC_BRIDGE_ADDRESS) throw new Error("AZTEC_BRIDGE_ADDRESS not set in .env - deploy Aztec bridge first");

const main = async () => {
    const value = process.argv[2] ? parseInt(process.argv[2]) : 42;

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

    // Ensure bridge contract is registered
    const bridgeAddress = AztecAddress.fromString(AZTEC_BRIDGE_ADDRESS!);
    const instance = await node.getContract(bridgeAddress);
    if (!instance) throw new Error("Aztec bridge contract not found - deploy first");
    await wallet.registerContract(instance, MessageBridgeContractArtifact);

    // Get MessageBridge contract
    const bridge = await MessageBridgeContract.at(bridgeAddress, wallet);

    console.log(`Sending value ${value} to EVM (chain ${ARBITRUM_SEPOLIA_CHAIN_ID})...`);

    const opts = await testnetSendWaitOpts(node, wallet, senderAddress);
    const receipt = await bridge.methods.send_value(
        ARBITRUM_SEPOLIA_CHAIN_ID,
        value,
        Fr.random() // fee nonce
    ).send(opts.send).wait(opts.wait);

    console.log(`Transaction sent! Hash: ${receipt.txHash}`);
    console.log("\nNext: Wait for the relayer to process this message and deliver it to EVM");
}

main().catch(console.error);
