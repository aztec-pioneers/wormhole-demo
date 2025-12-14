import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia, baseSepolia } from "viem/chains";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Supported EVM chains
export const SUPPORTED_EVM_CHAINS = {
    arbitrum: arbitrumSepolia,
    base: baseSepolia,
} as const;

export type EvmChainName = keyof typeof SUPPORTED_EVM_CHAINS;

// Load ABI from forge build output
const messageBridgeJson = JSON.parse(
    readFileSync(
        join(__dirname, "../../packages/evm/out/MessageBridge.sol/MessageBridge.json"),
        "utf-8"
    )
);

export const MESSAGE_BRIDGE_ABI = messageBridgeJson.abi;

export function createEvmClients(rpcUrl: string, privateKey: string, chainName: EvmChainName = "arbitrum") {
    const chain = SUPPORTED_EVM_CHAINS[chainName];
    const account = privateKeyToAccount(privateKey as `0x${string}`);

    const publicClient = createPublicClient({
        chain,
        transport: http(rpcUrl),
    });

    const walletClient = createWalletClient({
        account,
        chain,
        transport: http(rpcUrl),
    });

    return { account, publicClient, walletClient };
}
