#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();
import { fileURLToPath } from "url";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { createAztecNodeClient, Contract, Fr } from "@aztec/aztec.js";
import { AccountManager } from "@aztec/aztec.js/account";
import MessageBridgeContract from "../ts/artifacts/MessageBridge.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const { PXE_URL = "http://localhost:8080" } = process.env;

const EVM_WORMHOLE_CHAIN_ID = 10003; // Arbitrum Sepolia

type AccountData = {
    secretKey: string;
    salt: string;
    address: string;
}

const loadAccounts = (): AccountData[] => {
    const accountFilePath = join(__dirname, "data/accounts.json");
    if (!existsSync(accountFilePath)) {
        throw new Error("No accounts found. Run 'pnpm setup:accounts' first.");
    }
    return JSON.parse(readFileSync(accountFilePath, "utf-8"));
}

const loadAddresses = () => {
    const addressesFilePath = join(__dirname, "data/addresses.json");
    if (!existsSync(addressesFilePath)) {
        throw new Error("No deployment addresses found. Run 'pnpm setup:deploy' first.");
    }
    return JSON.parse(readFileSync(addressesFilePath, "utf-8"));
}

const main = async () => {
    const value = process.argv[2] ? parseInt(process.argv[2]) : 42;

    if (value < 0 || value > 255) {
        console.error("Value must be between 0 and 255");
        process.exit(1);
    }

    console.log(`Connecting to PXE at ${PXE_URL}...`);
    const pxe = createAztecNodeClient(PXE_URL);

    // Load accounts and addresses
    const accounts = loadAccounts();
    const senderAccount = accounts[0];
    const addresses = loadAddresses();

    console.log(`Using account: ${senderAccount.address}`);

    // Recreate wallet
    const secretKey = Fr.fromString(senderAccount.secretKey);
    const salt = Fr.fromString(senderAccount.salt);
    const wallet = await AccountManager.create(pxe, secretKey, salt);

    // Get MessageBridge contract
    const bridge = await Contract.at(addresses.messageBridge, MessageBridgeContract.artifact, wallet);

    console.log(`Sending value ${value} to EVM (chain ${EVM_WORMHOLE_CHAIN_ID})...`);

    const tx = await bridge.methods.send_value(
        EVM_WORMHOLE_CHAIN_ID,
        value,
        Fr.random() // fee nonce
    ).send();

    const receipt = await tx.wait();
    console.log(`✅ Transaction sent! Hash: ${receipt.txHash}`);
    console.log("\nNext: Wait for the relayer to process this message and deliver it to EVM");
}

main().catch(console.error);
