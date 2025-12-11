#!/usr/bin/env node
import { loadRootEnv, updateRootEnv } from "./utils/env";
loadRootEnv();
import { writeFileSync } from "fs";
import { AccountData, TESTNET_PXE_CONFIG, testnetSendWaitOpts } from "./utils/aztec";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { Fr } from "@aztec/aztec.js/fields";
import { TestWallet } from "@aztec/test-wallet/server";
import { AztecAddress } from "@aztec/aztec.js/addresses";

const { AZTEC_NODE_URL = "http://localhost:8080" } = process.env;
if (!AZTEC_NODE_URL) {
    throw new Error("AZTEC_NODE_URL not set in .env");
}
const accountFilePath = `${__dirname}/data/accounts.json`;

const main = async () => {
    console.log(`Connecting to Aztec Node at ${AZTEC_NODE_URL}...`);
    const node = createAztecNodeClient(AZTEC_NODE_URL);

    // Create new accounts
    console.log("Creating new accounts...");
    const wallet = await TestWallet.create(node, TESTNET_PXE_CONFIG)
    const accountData: AccountData[] = [];
    const numAccounts = 4;

    for (let i = 0; i < numAccounts; i++) {
        const secretKey = Fr.random();
        const salt = Fr.random();
        const manager = await wallet.createSchnorrAccount(secretKey, salt);
        const opts = await testnetSendWaitOpts(node, wallet, AztecAddress.ZERO);
        await manager.getDeployMethod()
            .then(method => method.send(opts.send).wait(opts.wait));
        console.log(`  Deployed account ${i + 1}: ${manager.address.toString()}`);

        accountData.push({
            secretKey: secretKey.toString(),
            salt: salt.toString(),
            address: manager.address.toString(),
        });
    }

    // Set the 4th account as the relayer account in .env
    updateRootEnv({
        "AZTEC_RELAYER_PRIVATE_KEY": accountData[3].secretKey,
        "AZTEC_RELAYER_SALT": accountData[3].salt,
    });

    // Save accounts to file
    writeFileSync(accountFilePath, JSON.stringify(accountData, null, 2));
    console.log(`\nSaved accounts to ${accountFilePath}`);
    console.log(`✅ Account setup complete! (${numAccounts} accounts created)`);
}

main().catch(console.error);
