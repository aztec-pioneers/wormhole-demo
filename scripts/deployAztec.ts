#!/usr/bin/env node
import { loadRootEnv, updateRootEnv } from "./utils/env";
loadRootEnv();

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { TestWallet } from "@aztec/test-wallet/server";
import { MessageBridgeContract } from "@aztec-wormhole-demo/aztec-sdk/artifacts";
import { WORMHOLE_CHAIN_IDS } from "@aztec-wormhole-demo/shared/constants";
import { loadAccount, MESSAGE_FEE, TESTNET_PXE_CONFIG, testnetSendWaitOpts } from "./utils/aztec";

const { AZTEC_NODE_URL, AZTEC_WORMHOLE_ADDRESS, AZTEC_WORMHOLE_CONSISTENCY } = process.env;
if (!AZTEC_NODE_URL) throw new Error("AZTEC_NODE_URL not set in .env");
if (!AZTEC_WORMHOLE_ADDRESS) throw new Error("AZTEC_WORMHOLE_ADDRESS not set in .env");
if (!AZTEC_WORMHOLE_CONSISTENCY) throw new Error("AZTEC_WORMHOLE_CONSISTENCY not set in .env");

const main = async () => {
    console.log(`Connecting to Aztec Node at ${AZTEC_NODE_URL}...`);
    const node = createAztecNodeClient(AZTEC_NODE_URL);
    
    // Load account
    const wallet = await TestWallet.create(node, TESTNET_PXE_CONFIG);
    const adminAddress = await loadAccount(node, wallet);

    console.log(`Using admin account: ${adminAddress.toString()}`);

    const consistency = parseInt(AZTEC_WORMHOLE_CONSISTENCY, 10);
    console.log("Deploying MessageBridge contract...");
    console.log(`  Wormhole Address: ${AZTEC_WORMHOLE_ADDRESS}`);
    console.log(`  Wormhole Chain ID: ${WORMHOLE_CHAIN_IDS.aztec}`);
    console.log(`  Consistency: ${consistency}`);
    const opts = await testnetSendWaitOpts(node, wallet, adminAddress);
    const messageBridge = await MessageBridgeContract.deploy(
        wallet,
        AztecAddress.fromString(AZTEC_WORMHOLE_ADDRESS),
        WORMHOLE_CHAIN_IDS.aztec,  // Use Wormhole chain ID (56), not Aztec testnet chain ID
        adminAddress,
        MESSAGE_FEE,
        consistency
    ).send(opts.send).deployed(opts.wait);
        
    const bridgeAddress = messageBridge.address.toString();
    console.log(`✅ MessageBridge deployed at: ${bridgeAddress}`);

    updateRootEnv({AZTEC_BRIDGE_ADDRESS: bridgeAddress});
    console.log("✅ Deployment complete!");
}

main().catch(console.error);
