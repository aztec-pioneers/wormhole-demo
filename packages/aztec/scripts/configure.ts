// #!/usr/bin/env node
// import "dotenv/config";
// import { fileURLToPath } from "url";
// import { dirname, join } from "path";
// import { existsSync, readFileSync } from "fs";
// // import { createAztecNodeClient, Contract, Fr } from "@aztec/aztec.js";
// // import { AccountManager } from "@aztec/aztec.js/account";
// import { MessageBridgeContract} from "../src/artifacts";
// import { AccountManager } from "@aztec/aztec.js/wallet";
// import { Fr } from "@aztec/aztec.js/fields";
// import { createAztecNodeClient } from "@aztec/aztec.js/node";

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = dirname(__filename);


// const { AZTEC_NODE_URL = "http://localhost:8080", EVM_BRIDGE_ADDRESS } = process.env;

// const EVM_WORMHOLE_CHAIN_ID = 10003; // Arbitrum Sepolia

// type AccountData = {
//     secretKey: string;
//     salt: string;
//     address: string;
// }

// const loadAccounts = (): AccountData[] => {
//     const accountFilePath = join(__dirname, "data/accounts.json");
//     if (!existsSync(accountFilePath)) {
//         throw new Error("No accounts found. Run 'pnpm setup:accounts' first.");
//     }
//     return JSON.parse(readFileSync(accountFilePath, "utf-8"));
// }

// const loadAddresses = () => {
//     const addressesFilePath = join(__dirname, "data/addresses.json");
//     if (!existsSync(addressesFilePath)) {
//         throw new Error("No deployment addresses found. Run 'pnpm setup:deploy' first.");
//     }
//     return JSON.parse(readFileSync(addressesFilePath, "utf-8"));
// }

// const main = async () => {
//     if (!EVM_BRIDGE_ADDRESS) {
//         console.log("⚠️  EVM_BRIDGE_ADDRESS not set in .env");
//         console.log("Deploy the EVM MessageBridge first, then set EVM_BRIDGE_ADDRESS and run this again.");
//         process.exit(0);
//     }

//     console.log(`Connecting to node at ${PXE_URL}...`);
//     const node = createAztecNodeClient(PXE_URL);

//     // Load accounts and addresses
//     const accounts = loadAccounts();
//     const adminAccount = accounts[0];
//     const addresses = loadAddresses();

//     console.log(`Using admin account: ${adminAccount.address}`);

//     // Recreate wallet
//     const secretKey = Fr.fromString(adminAccount.secretKey);
//     const salt = Fr.fromString(adminAccount.salt);
//     const wallet = await AccountManager.create(pxe, secretKey, salt);

//     // Get MessageBridge contract
//     const bridge = await MessageBridgeContract.at(addresses.messageBridge, wallet);

//     console.log("Registering EVM emitter on Aztec bridge...");
//     console.log(`  EVM Chain ID: ${EVM_WORMHOLE_CHAIN_ID}`);
//     console.log(`  EVM Bridge: ${EVM_BRIDGE_ADDRESS}`);

//     // Convert EVM address to bytes32 (pad with zeros on the left)
//     const evmAddressBytes32 = EVM_BRIDGE_ADDRESS.replace("0x", "").padStart(64, "0");
//     const emitterBytes = Buffer.from(evmAddressBytes32, "hex");

//     await bridge.methods.register_emitter(EVM_WORMHOLE_CHAIN_ID, Array.from(emitterBytes))
//         .send()
//         .wait();

//     console.log("✅ Configuration complete!");
//     console.log("\nNext steps:");
//     console.log("1. Configure the EVM bridge to trust the Aztec emitter");
//     console.log(`2. Call registerEmitter(56, ${addresses.messageBridge}) on EVM MessageBridge`);
// }

// main().catch(console.error);
