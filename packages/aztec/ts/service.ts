import "dotenv/config";
import express from "express";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";
import { createAztecNodeClient, type AztecNode } from "@aztec/aztec.js/node";
import { getPXEConfig } from "@aztec/pxe/server";
import { createStore } from "@aztec/kv-store/lmdb";
import { TestWallet } from "@aztec/test-wallet/server";
import { AztecMessageBridgeClient } from "./client.js";
import { getSponsoredPaymentMethod, getPriorityFeeOptions } from "./fees.js";
import { WormholeContractArtifact } from "./artifacts/index.js";

const PORT = process.env.PORT || 3000;
const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL;
const AZTEC_RELAYER_PRIVATE_KEY = process.env.AZTEC_RELAYER_PRIVATE_KEY;
const AZTEC_RELAYER_SALT = process.env.AZTEC_RELAYER_SALT;
const AZTEC_WORMHOLE_ADDRESS = process.env.AZTEC_WORMHOLE_ADDRESS;
const AZTEC_BRIDGE_ADDRESS = process.env.AZTEC_BRIDGE_ADDRESS;

let client: AztecMessageBridgeClient;
let node: AztecNode;
let relayerAddress: AztecAddress;
let paymentMethod: Awaited<ReturnType<typeof getSponsoredPaymentMethod>>;

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
    res.json({
        status: client ? "healthy" : "initializing",
        network: "devnet",
        timestamp: new Date().toISOString(),
        nodeUrl: AZTEC_NODE_URL,
        bridgeAddress: AZTEC_BRIDGE_ADDRESS,
        relayerAddress: relayerAddress?.toString() ?? "not_initialized",
    });
});

app.post("/verify", async (req, res) => {
    if (!client) {
        return res.status(503).json({
            success: false,
            error: "Service not ready - Aztec devnet connection still initializing",
        });
    }

    try {
        const { vaaBytes } = req.body;
        if (!vaaBytes) {
            return res.status(400).json({ success: false, error: "vaaBytes is required" });
        }

        // Get dynamic priority fee options
        const feeOptions = {
            from: relayerAddress,
            fee: {
                ...(await getPriorityFeeOptions(node, 2n)),
                paymentMethod,
            },
        };

        const txHash = await client.receiveValue(vaaBytes, feeOptions);

        res.json({
            success: true,
            network: "devnet",
            txHash,
            message: "VAA verified successfully on Aztec devnet",
            processedAt: new Date().toISOString(),
        });
    } catch (error: any) {
        console.error("VAA verification failed:", error.message);
        res.status(500).json({
            success: false,
            network: "devnet",
            error: error.message,
            processedAt: new Date().toISOString(),
        });
    }
});

async function init() {
    // Validate env
    if (!AZTEC_NODE_URL) throw new Error("AZTEC_NODE_URL not set");
    if (!AZTEC_RELAYER_PRIVATE_KEY) throw new Error("AZTEC_RELAYER_PRIVATE_KEY not set");
    if (!AZTEC_RELAYER_SALT) throw new Error("AZTEC_RELAYER_SALT not set");
    if (!AZTEC_WORMHOLE_ADDRESS) throw new Error("AZTEC_WORMHOLE_ADDRESS not set");
    if (!AZTEC_BRIDGE_ADDRESS) throw new Error("AZTEC_BRIDGE_ADDRESS not set");

    // Initialize node and wallet
    node = createAztecNodeClient(AZTEC_NODE_URL);
    const pxeConfig = { proverEnabled: true };
    const pxeOptions = {
        store: await createStore("pxe", { dataDirectory: "store", dataStoreMapSizeKb: 1e6 }),
    };
    const wallet = await TestWallet.create(node, pxeConfig, pxeOptions);
    console.log("Connected to Aztec node");

    // Register relayer account
    const relayerSecretKey = Fr.fromString(AZTEC_RELAYER_PRIVATE_KEY);
    const relayerSalt = Fr.fromString(AZTEC_RELAYER_SALT);
    relayerAddress = (await wallet.createSchnorrAccount(relayerSecretKey, relayerSalt)).address;
    console.log(`Relayer account: ${relayerAddress}`);

    // Get FPC payment method
    paymentMethod = await getSponsoredPaymentMethod(wallet);

    // Register Wormhole contract (needed for emitter address)
    const wormholeAddress = AztecAddress.fromString(AZTEC_WORMHOLE_ADDRESS);
    const wormholeInstance = await node.getContract(wormholeAddress);
    if (!wormholeInstance) throw new Error(`Wormhole contract not found at ${AZTEC_WORMHOLE_ADDRESS}`);
    await wallet.registerContract(wormholeInstance, WormholeContractArtifact);

    // Create client
    client = await AztecMessageBridgeClient.create({
        node,
        wallet,
        bridgeAddress: AztecAddress.fromString(AZTEC_BRIDGE_ADDRESS),
        wormholeAddress,
        accountAddress: relayerAddress,
    });
    console.log("AztecMessageBridgeClient initialized");
}

init()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Aztec VAA Service running on port ${PORT}`);
            console.log(`  Node: ${AZTEC_NODE_URL}`);
            console.log(`  Bridge: ${AZTEC_BRIDGE_ADDRESS}`);
        });
    })
    .catch((error) => {
        console.error("Failed to start service:", error);
        process.exit(1);
    });
