/**
 * Unified client factories for all chains.
 * Each factory reads configuration from environment variables.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia, baseSepolia } from "viem/chains";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { TestWallet } from "@aztec/test-wallet/server";
import { Fr } from "@aztec/aztec.js/fields";
import type { BaseMessageBridgeEmitter, NetworkName } from "@aztec-wormhole-demo/shared";
import { EvmMessageBridgeClient } from "@aztec-wormhole-demo/evm-sdk";
import { SolanaMessageBridgeClient, WORMHOLE_PROGRAM_ID } from "@aztec-wormhole-demo/solana-sdk";
import { AztecMessageBridgeClient, getPriorityFeeOptions, getSponsoredPaymentMethod } from "@aztec-wormhole-demo/aztec-contracts";
import { loadKeypair } from "./solana";
import { getTestnetPxeConfig } from "./aztec";
import { requireEnv } from "./env";

// ============================================================
// EVM CLIENTS
// ============================================================

const EVM_CHAINS = {
    arbitrum: {
        chain: arbitrumSepolia,
        rpcEnvVar: "ARBITRUM_RPC_URL",
        bridgeEnvVar: "ARBITRUM_BRIDGE_ADDRESS",
        displayName: "Arbitrum Sepolia",
    },
    base: {
        chain: baseSepolia,
        rpcEnvVar: "BASE_RPC_URL",
        bridgeEnvVar: "BASE_BRIDGE_ADDRESS",
        displayName: "Base Sepolia",
    },
} as const;

export type EvmChainName = keyof typeof EVM_CHAINS;

export async function createEvmClient(chainName: EvmChainName): Promise<EvmMessageBridgeClient> {
    const config = EVM_CHAINS[chainName];
    const privateKey = requireEnv("EVM_PRIVATE_KEY");
    const rpcUrl = requireEnv(config.rpcEnvVar);
    const bridgeAddress = requireEnv(config.bridgeEnvVar);

    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const publicClient = createPublicClient({ chain: config.chain, transport: http(rpcUrl) });
    const walletClient = createWalletClient({ account, chain: config.chain, transport: http(rpcUrl) });

    return EvmMessageBridgeClient.create({
        publicClient,
        walletClient,
        bridgeAddress: bridgeAddress as `0x${string}`,
        chainName: config.displayName,
    });
}

// ============================================================
// SOLANA CLIENT
// ============================================================

export async function createSolanaClient(): Promise<SolanaMessageBridgeClient> {
    const rpcUrl = requireEnv("SOLANA_RPC_URL");
    const programId = requireEnv("SOLANA_BRIDGE_PROGRAM_ID");

    const connection = new Connection(rpcUrl, "confirmed");
    const payer = loadKeypair();

    const wormholeProgramId = process.env.SOLANA_WORMHOLE_PROGRAM_ID
        ? new PublicKey(process.env.SOLANA_WORMHOLE_PROGRAM_ID)
        : WORMHOLE_PROGRAM_ID;

    return SolanaMessageBridgeClient.create({
        connection,
        programId: new PublicKey(programId),
        payer,
        wormholeProgramId,
    });
}

// ============================================================
// AZTEC CLIENT
// ============================================================

export async function createAztecClient(): Promise<AztecMessageBridgeClient> {
    const nodeUrl = requireEnv("AZTEC_NODE_URL");
    const bridgeAddress = requireEnv("AZTEC_BRIDGE_ADDRESS");
    const wormholeAddress = requireEnv("AZTEC_WORMHOLE_ADDRESS");
    const privateKey = requireEnv("AZTEC_RELAYER_PRIVATE_KEY");
    const salt = requireEnv("AZTEC_RELAYER_SALT");

    const node = createAztecNodeClient(nodeUrl);
    const wallet = await TestWallet.create(node, getTestnetPxeConfig());

    const secretKey = Fr.fromString(privateKey);
    const manager = await wallet.createSchnorrAccount(secretKey, Fr.fromString(salt));
    const accountAddress = manager.address;

    const fee = {
        ...(await getPriorityFeeOptions(node, 2n)),
        paymentMethod: await getSponsoredPaymentMethod(wallet),
    };

    return AztecMessageBridgeClient.create({
        node,
        wallet,
        bridgeAddress: AztecAddress.fromString(bridgeAddress),
        wormholeAddress: AztecAddress.fromString(wormholeAddress),
        accountAddress,
        sendOptions: { from: accountAddress, fee },
        waitOptions: { timeout: 3600, interval: 3 },
    });
}

// ============================================================
// ALL CLIENTS
// ============================================================


export async function createAllClients(): Promise<Record<NetworkName, BaseMessageBridgeEmitter>> {
    const [arbitrum, base, aztec, solana] = await Promise.all([
        createEvmClient("arbitrum"),
        createEvmClient("base"),
        createAztecClient(),
        createSolanaClient(),
    ]);

    return { arbitrum, base, aztec, solana };
}
