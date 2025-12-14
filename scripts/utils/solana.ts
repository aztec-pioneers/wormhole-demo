import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { SolanaMessageBridgeClient, WORMHOLE_PROGRAM_ID } from "@aztec-wormhole-demo/solana-sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Default paths
const SOLANA_DIR = join(__dirname, "../../packages/solana/message_bridge");
const DEFAULT_KEYPAIR_PATH = join(process.env.HOME || "~", ".config/solana/id.json");

/**
 * Load a keypair - first tries SOLANA_PRIVATE_KEY from env, then falls back to file
 *
 * Env formats supported:
 * - Base58 encoded private key (standard Solana format)
 * - JSON array of bytes (same as file format)
 */
export function loadKeypair(path?: string): Keypair {
    // First try loading from environment
    const envKey = process.env.SOLANA_PRIVATE_KEY;
    if (envKey) {
        try {
            // Try base58 format first (most common for Solana)
            if (!envKey.startsWith("[")) {
                const decoded = bs58.decode(envKey);
                return Keypair.fromSecretKey(decoded);
            }
            // Try JSON array format
            const keypairData = JSON.parse(envKey);
            return Keypair.fromSecretKey(Uint8Array.from(keypairData));
        } catch (e) {
            console.warn("Failed to parse SOLANA_PRIVATE_KEY from env, falling back to file");
        }
    }

    // Fall back to file
    const keypairPath = path ?? DEFAULT_KEYPAIR_PATH;
    if (!existsSync(keypairPath)) {
        throw new Error(
            `Solana keypair not found. Set SOLANA_PRIVATE_KEY in .env or create keypair at ${keypairPath}`
        );
    }
    const keypairData = JSON.parse(readFileSync(keypairPath, "utf8"));
    return Keypair.fromSecretKey(Uint8Array.from(keypairData));
}

/**
 * Get the program keypair (for deployment)
 */
export function getProgramKeypair(): Keypair {
    const keypairPath = join(SOLANA_DIR, "target/deploy/message_bridge-keypair.json");
    return loadKeypair(keypairPath);
}

/**
 * Format a 32-byte array as hex string
 */
export function formatEmitterAddress(address: Uint8Array): string {
    return "0x" + Buffer.from(address).toString("hex");
}

/**
 * Parse hex string to Uint8Array (32 bytes)
 */
export function parseEmitterAddress(hex: string): Uint8Array {
    const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (cleanHex.length !== 64) {
        throw new Error(`Invalid emitter address length: expected 64 hex chars, got ${cleanHex.length}`);
    }
    return new Uint8Array(Buffer.from(cleanHex, "hex"));
}
