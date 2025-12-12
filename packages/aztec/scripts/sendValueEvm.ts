#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();

import { createEvmClients, MESSAGE_BRIDGE_ABI } from "./utils/evm";
import { getAddress } from "viem";
import { AZTEC_WORMHOLE_CHAIN_ID } from "../ts/constants";

const { ARBITRUM_RPC_URL, EVM_PRIVATE_KEY, EVM_BRIDGE_ADDRESS } = process.env;

if (!ARBITRUM_RPC_URL) throw new Error("ARBITRUM_RPC_URL not set in .env");
if (!EVM_PRIVATE_KEY) throw new Error("EVM_PRIVATE_KEY not set in .env");
if (!EVM_BRIDGE_ADDRESS) throw new Error("EVM_BRIDGE_ADDRESS not set in .env - deploy EVM bridge first");

// Minimal ABI to read message fee from Wormhole contract
const WORMHOLE_ABI = [
    {
        name: "messageFee",
        type: "function",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "uint256" }],
    },
] as const;

const main = async () => {
    let value: bigint;
    try {
        value = process.argv[2] ? BigInt(process.argv[2]) : 42n;
    } catch {
        console.error("Invalid value - must be a valid integer");
        process.exit(1);
    }

    const MAX_U128 = 2n ** 128n - 1n;
    if (value < 0n || value > MAX_U128) {
        console.error(`Value must be between 0 and ${MAX_U128}`);
        process.exit(1);
    }

    console.log(`Connecting to Arbitrum Sepolia...`);
    const { account, publicClient, walletClient } = createEvmClients(ARBITRUM_RPC_URL!, EVM_PRIVATE_KEY!);
    const bridgeAddress = getAddress(EVM_BRIDGE_ADDRESS!);

    console.log(`Using account: ${account.address}`);
    console.log(`Bridge address: ${bridgeAddress}`);

    // Get the Wormhole contract address from the bridge
    const wormholeAddress = await publicClient.readContract({
        address: bridgeAddress,
        abi: MESSAGE_BRIDGE_ABI,
        functionName: "wormhole",
    }) as `0x${string}`;

    // Get the Wormhole message fee from the Wormhole contract
    const messageFee = await publicClient.readContract({
        address: wormholeAddress,
        abi: WORMHOLE_ABI,
        functionName: "messageFee",
    }) as bigint;

    console.log(`Wormhole message fee: ${messageFee} wei`);

    console.log(`\nSending value ${value} to Aztec (chain ${AZTEC_WORMHOLE_CHAIN_ID})...`);

    const hash = await walletClient.writeContract({
        address: bridgeAddress,
        abi: MESSAGE_BRIDGE_ABI,
        functionName: "sendValue",
        args: [AZTEC_WORMHOLE_CHAIN_ID, value],
        value: messageFee,
    });

    console.log(`Transaction submitted: ${hash}`);

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`Transaction confirmed in block ${receipt.blockNumber}`);

    // Check for ValueSent event from the bridge
    const valueSentEvent = receipt.logs.find(log =>
        log.address.toLowerCase() === bridgeAddress.toLowerCase()
    );

    if (valueSentEvent) {
        console.log(`\nMessage sent successfully!`);
    }

    console.log(`\nSource chain explorer: https://sepolia.arbiscan.io/tx/${hash}`);
    console.log(`Wormhole explorer: https://wormholescan.io/#/tx/${hash}?network=Testnet`);

    console.log(`\nNext: Wait for the relayer to process this message and deliver it to Aztec`);
}

main().catch(console.error);
