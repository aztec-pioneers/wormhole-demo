#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { writeFileSync } from "fs";
import { MessageBridgeContract } from "../ts/artifacts";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { loadAccounts, MESSAGE_FEE, TESTNET_PXE_CONFIG, testnetSendWaitOpts } from "./utils/aztec";
import { TestWallet } from "@aztec/test-wallet/server";
import { AZTEC_TEST_CHAIN_ID } from "@aztec/ethereum";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { updateRootEnv } from "./utils/env";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { AZTEC_NODE_URL, AZTEC_WORMHOLE_ADDRESS } = process.env;
if (!AZTEC_NODE_URL) throw new Error("AZTEC_NODE_URL not set in .env");
if (!AZTEC_WORMHOLE_ADDRESS) throw new Error("AZTEC_WORMHOLE_ADDRESS not set in .env");

const main = async () => {
    console.log(`Connecting to Aztec Node at ${AZTEC_NODE_URL}...`);
    const node = createAztecNodeClient(AZTEC_NODE_URL);
    
    // Load accounts
    const wallet = await TestWallet.create(node, TESTNET_PXE_CONFIG);
    const [adminAddress] = await loadAccounts(node, wallet);

    console.log(`Using admin account: ${adminAddress.toString()}`);

    console.log("Deploying MessageBridge contract...");
    const opts = await testnetSendWaitOpts(node, wallet, adminAddress);
    const messageBridge = await MessageBridgeContract.deploy(
        wallet,
        AztecAddress.fromString(AZTEC_WORMHOLE_ADDRESS),
        AZTEC_TEST_CHAIN_ID,
        adminAddress,
        MESSAGE_FEE
    ).send(opts.send).deployed(opts.wait);
        
    const bridgeAddress = messageBridge.address.toString();
    console.log(`✅ MessageBridge deployed at: ${bridgeAddress}`);

    // Save deployment addresses
    const addressesFilePath = join(__dirname, "data/addresses.json");
    const addresses = {
        wormhole: AZTEC_WORMHOLE_ADDRESS,
        messageBridge: bridgeAddress,
    };

    writeFileSync(addressesFilePath, JSON.stringify(addresses, null, 2));
    console.log(`Saved addresses to ${addressesFilePath}`);

    // Update root .env for docker automatically
    updateRootEnv({
        AZTEC_BRIDGE_ADDRESS: bridgeAddress,
        AZTEC_EMITTER_ADDRESS: bridgeAddress,
    });
    console.log("Auto-updated root .env file with deployment addresses for docker");

    console.log("✅ Deployment complete!");
}

main().catch(console.error);
