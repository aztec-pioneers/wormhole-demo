#!/usr/bin/env node
import { loadRootEnv, updateRootEnv } from "./utils/env";
loadRootEnv();
import { TESTNET_PXE_CONFIG, testnetSendWaitOpts } from "./utils/aztec";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { Fr } from "@aztec/aztec.js/fields";
import { TestWallet } from "@aztec/test-wallet/server";
import { AztecAddress } from "@aztec/aztec.js/addresses";

const { AZTEC_NODE_URL = "http://localhost:8080" } = process.env;
if (!AZTEC_NODE_URL) {
    throw new Error("AZTEC_NODE_URL not set in .env");
}

const main = async () => {
    console.log(`Connecting to Aztec Node at ${AZTEC_NODE_URL}...`);
    const node = createAztecNodeClient(AZTEC_NODE_URL);

    // Create single account
    console.log("Creating account...");
    const wallet = await TestWallet.create(node, TESTNET_PXE_CONFIG);

    const secretKey = Fr.random();
    const salt = Fr.random();
    const manager = await wallet.createSchnorrAccount(secretKey, salt);
    const opts = await testnetSendWaitOpts(node, wallet, AztecAddress.ZERO);
    await manager.getDeployMethod()
        .then(method => method.send(opts.send).wait(opts.wait));
    console.log(`  Deployed account: ${manager.address.toString()}`);

    // Save account credentials to root .env
    updateRootEnv({
        "AZTEC_RELAYER_PRIVATE_KEY": secretKey.toString(),
        "AZTEC_RELAYER_SALT": salt.toString(),
    });

    console.log(`✅ Account setup complete!`);
}

main().catch(console.error);
