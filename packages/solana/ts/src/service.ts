import "dotenv/config";
import express, { Request, Response } from "express";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { SolanaMessageBridgeClient } from "./client.js";
import { WORMHOLE_PROGRAM_ID } from "./constants.js";

const PORT = parseInt(process.env.PORT || "3001", 10);
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const SOLANA_PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY || "";
const SOLANA_WORMHOLE_PROGRAM_ID = process.env.SOLANA_WORMHOLE_PROGRAM_ID;
const SOLANA_BRIDGE_PROGRAM_ID = process.env.SOLANA_BRIDGE_PROGRAM_ID;

if (!SOLANA_PRIVATE_KEY) {
    console.error("SOLANA_PRIVATE_KEY is required");
    process.exit(1);
}

const keypair = Keypair.fromSecretKey(bs58.decode(SOLANA_PRIVATE_KEY));
const connection = new Connection(SOLANA_RPC_URL, "confirmed");

let client: SolanaMessageBridgeClient;

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req: Request, res: Response) => {
    res.json({
        status: client ? "ok" : "initializing",
        payer: keypair.publicKey.toBase58(),
        wormholeProgram: SOLANA_WORMHOLE_PROGRAM_ID ?? WORMHOLE_PROGRAM_ID.toBase58(),
    });
});

app.post("/post-vaa", async (req: Request, res: Response) => {
    try {
        const { vaa } = req.body;
        if (!vaa) {
            res.status(400).json({ error: "Missing vaa in request body" });
            return;
        }

        console.log(`Posting VAA to Solana (${vaa.length / 2} bytes)...`);

        const signature = await client.postVaaToWormhole(vaa);

        if (signature === "already_posted") {
            console.log("VAA already posted to Wormhole");
            res.json({
                success: true,
                signature: "already_posted",
                message: "VAA already posted to Wormhole",
            });
            return;
        }

        console.log(`VAA posted successfully: ${signature}`);
        res.json({
            success: true,
            signature,
            wormholeProgramId: SOLANA_WORMHOLE_PROGRAM_ID ?? WORMHOLE_PROGRAM_ID.toBase58(),
        });
    } catch (error: any) {
        console.error("Failed to post VAA:", error);

        // Check for "already in use" error
        if (error.message?.includes("already in use") || error.message?.includes("already exists")) {
            res.json({
                success: true,
                signature: "already_posted",
                message: "VAA already posted to Wormhole",
            });
            return;
        }

        res.status(500).json({
            error: error.message || "Failed to post VAA",
            details: error.logs || undefined,
        });
    }
});

async function init() {
    // Create a dummy program ID if not provided (service only posts to Wormhole, not our bridge)
    const programId = SOLANA_BRIDGE_PROGRAM_ID
        ? new PublicKey(SOLANA_BRIDGE_PROGRAM_ID)
        : keypair.publicKey; // placeholder - not used for postVaaToWormhole

    const wormholeProgramId = SOLANA_WORMHOLE_PROGRAM_ID
        ? new PublicKey(SOLANA_WORMHOLE_PROGRAM_ID)
        : WORMHOLE_PROGRAM_ID;

    client = await SolanaMessageBridgeClient.create({
        connection,
        programId,
        payer: keypair,
        wormholeProgramId,
    });

    console.log("SolanaMessageBridgeClient initialized");
}

init()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Solana VAA Service listening on port ${PORT}`);
            console.log(`  Solana RPC: ${SOLANA_RPC_URL}`);
            console.log(`  Wormhole Program: ${SOLANA_WORMHOLE_PROGRAM_ID ?? WORMHOLE_PROGRAM_ID.toBase58()}`);
            console.log(`  Payer: ${keypair.publicKey.toBase58()}`);
        });
    })
    .catch((error) => {
        console.error("Failed to start service:", error);
        process.exit(1);
    });
