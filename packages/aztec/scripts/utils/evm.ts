import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load ABI from forge build output
const messageBridgeJson = JSON.parse(
    readFileSync(
        join(__dirname, "../../../evm/out/MessageBridge.sol/MessageBridge.json"),
        "utf-8"
    )
);

export const MESSAGE_BRIDGE_ABI = messageBridgeJson.abi;

export function createEvmClients(rpcUrl: string, privateKey: string) {
    const account = privateKeyToAccount(privateKey as `0x${string}`);

    const publicClient = createPublicClient({
        chain: arbitrumSepolia,
        transport: http(rpcUrl),
    });

    const walletClient = createWalletClient({
        account,
        chain: arbitrumSepolia,
        transport: http(rpcUrl),
    });

    return { account, publicClient, walletClient };
}
