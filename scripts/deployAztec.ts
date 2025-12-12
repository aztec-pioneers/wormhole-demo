#!/usr/bin/env node
import { loadRootEnv, updateRootEnv } from "./utils/env";
loadRootEnv();
import { MessageBridgeContract } from "@aztec-wormhole-demo/aztec-contracts/artifacts";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { loadAccount, MESSAGE_FEE, TESTNET_PXE_CONFIG, testnetSendWaitOpts } from "./utils/aztec";
import { TestWallet } from "@aztec/test-wallet/server";
import { AZTEC_WORMHOLE_CHAIN_ID } from "@aztec-wormhole-demo/aztec-contracts/constants";
import { AztecAddress } from "@aztec/aztec.js/addresses";

const { AZTEC_NODE_URL, AZTEC_WORMHOLE_ADDRESS } = process.env;
if (!AZTEC_NODE_URL) throw new Error("AZTEC_NODE_URL not set in .env");
if (!AZTEC_WORMHOLE_ADDRESS) throw new Error("AZTEC_WORMHOLE_ADDRESS not set in .env");

const main = async () => {
    console.log(`Connecting to Aztec Node at ${AZTEC_NODE_URL}...`);
    const node = createAztecNodeClient(AZTEC_NODE_URL);
    
    // Load account
    const wallet = await TestWallet.create(node, TESTNET_PXE_CONFIG);
    const adminAddress = await loadAccount(node, wallet);

    console.log(`Using admin account: ${adminAddress.toString()}`);

    console.log("Deploying MessageBridge contract...");
    const opts = await testnetSendWaitOpts(node, wallet, adminAddress);
    const messageBridge = await MessageBridgeContract.deploy(
        wallet,
        AztecAddress.fromString(AZTEC_WORMHOLE_ADDRESS),
        AZTEC_WORMHOLE_CHAIN_ID,  // Use Wormhole chain ID (56), not Aztec testnet chain ID
        adminAddress,
        MESSAGE_FEE
    ).send(opts.send).deployed(opts.wait);
        
    const bridgeAddress = messageBridge.address.toString();
    console.log(`✅ MessageBridge deployed at: ${bridgeAddress}`);

    updateRootEnv({AZTEC_BRIDGE_ADDRESS: bridgeAddress});
    console.log("✅ Deployment complete!");
}

main().catch(console.error);
