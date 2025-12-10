#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();
import { writeFileSync } from "fs";
import { AccountData, TESTNET_PXE_CONFIG, testnetSendWaitOpts } from "./utils/aztec";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { Fr } from "@aztec/aztec.js/fields";
import { TestWallet } from "@aztec/test-wallet/server";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { execCommand } from "./utils/cmd";
import { join } from "path";
import { getSponsoredFPCAddress } from "../ts/fees";
import { updateRootEnv } from "./utils/env";

const { AZTEC_NODE_URL } = process.env;
if (!AZTEC_NODE_URL) throw new Error("AZTEC_NODE_URL not set in .env");

// registers an account with locally running PXE for the relayer
const main = async () => {
    // create account with the aztec-wallet cli
    const aztecBinPath = process.env.HOME + "/.aztec/bin";
    const newPath = aztecBinPath + ":" + process.env.PATH;
    const secretKey = Fr.random();
    await execCommand("aztec-wallet", [
        "create-account",
        "-sk",
        secretKey.toString(),
        "--register-only",
        "--node-url",
        AZTEC_NODE_URL,
        "--alias",
        "relayer-account"
    ], undefined, { PATH: newPath });

    // register the sponsored fpc
    const sponsoredFPCAddress = await getSponsoredFPCAddress();
    await execCommand("aztec-wallet", [
        "register-contract",
        sponsoredFPCAddress.toString(),
        "SponsoredFPC",
        "--node-url",
        AZTEC_NODE_URL,
        "--alias",
        "sponsoredFPC",
    ], undefined, { PATH: newPath });

    // deploy the relayer account
    await execCommand("aztec-wallet", [
        "deploy-account",
        "relayer-account",
        "--node-url",
        AZTEC_NODE_URL,
        "--payment",
        "method=fpc-sponsored,fpc=contracts:sponsoredFPC"
    ], undefined, { PATH: newPath });
    console.log("Relayer account created and deployed with sponsored FPC payment method.");

    updateRootEnv({ "AZTEC_PRIVATE_KEY": secretKey.toString() });
}

main().catch(console.error);
