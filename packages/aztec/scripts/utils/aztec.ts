import { AztecAddress } from "@aztec/aztec.js/addresses";
import { SendInteractionOptions, WaitOpts } from "@aztec/aztec.js/contracts";
import { AztecNode } from "@aztec/aztec.js/node";
import { BaseWallet } from "@aztec/aztec.js/wallet";
import { PXEConfig } from "@aztec/pxe/config";
import { getPriorityFeeOptions, getSponsoredPaymentMethod } from "../../ts/fees";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";
import { TestWallet } from "@aztec/test-wallet/server";
import { Fr } from "@aztec/aztec.js/fields";

const __dirname = dirname(fileURLToPath(import.meta.url));
const accountsFilePath = join(__dirname, "../data/accounts.json");

export type AccountData = {
    secretKey: string;
    salt: string;
    address: string;
}

export function getTestnetPxeConfig(): Partial<PXEConfig> {
    const { ROLLUP_VERSION } = process.env;
    if (!ROLLUP_VERSION) {
        throw new Error("ROLLUP_VERSION not set in .env");
    }
    return {
        rollupVersion: Number(ROLLUP_VERSION),
        proverEnabled: false
    };
}

// For backwards compatibility - lazy getter
export const TESTNET_PXE_CONFIG: Partial<PXEConfig> = new Proxy({} as Partial<PXEConfig>, {
    get(_, prop) {
        return getTestnetPxeConfig()[prop as keyof Partial<PXEConfig>];
    }
});

export const TESTNET_TIMEOUT = 3600; // seconds until timeout waiting for send
export const TESTNET_INTERNAL = 3; // seconds between polling for tx
export const MESSAGE_FEE = 0n; // default message fee for wormhole

export async function isDevnet(node: AztecNode): Promise<boolean> {
    const chainId = await node.getNodeInfo().then(info => info.l1ChainId);
    return chainId === 11155111; // Sepolia testnet
}

export async function testnetSendWaitOpts(
    node: AztecNode,
    wallet: BaseWallet,
    from: AztecAddress
): Promise<{
    send: SendInteractionOptions,
    wait: WaitOpts
}> {
    const fee = {
        ...(await getPriorityFeeOptions(node, 2n)),
        paymentMethod: await getSponsoredPaymentMethod(wallet)
    };
    return {
        send: { from, fee },
        wait: { timeout: TESTNET_TIMEOUT, interval: TESTNET_INTERNAL }
    };
}

export const loadAccounts = async (
    node: AztecNode,
    wallet: TestWallet
): Promise<AztecAddress[]> => {
    if (!await isDevnet(node))
        throw new Error("Can only run Wormhole on devnet!");
    if (!existsSync(accountsFilePath))
        throw new Error("No accounts found. Run 'pnpm setup:accounts' first.");
    const accounts: AccountData[] = JSON.parse(readFileSync(accountsFilePath, "utf-8"));
    console.log(`Loaded ${accounts.length} accounts from fs...`);
    for (const account of accounts) {
        const secretKey = Fr.fromString(account.secretKey);
        const salt = Fr.fromString(account.salt);
        await wallet.createSchnorrAccount(secretKey, salt);
    }
    return accounts.map(acc => AztecAddress.fromString(acc.address));
}