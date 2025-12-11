#!/usr/bin/env node
import { loadRootEnv } from "./utils/env";
loadRootEnv();

import { createEvmClients, MESSAGE_BRIDGE_ABI } from "./utils/evm";
import { getAddress, parseEther } from "viem";
import { AZTEC_WORMHOLE_CHAIN_ID } from "../ts/constants";

const { ARBITRUM_RPC_URL, EVM_PRIVATE_KEY, EVM_BRIDGE_ADDRESS } = process.env;

if (!ARBITRUM_RPC_URL) throw new Error("ARBITRUM_RPC_URL not set in .env");
if (!EVM_PRIVATE_KEY) throw new Error("EVM_PRIVATE_KEY not set in .env");
if (!EVM_BRIDGE_ADDRESS) throw new Error("EVM_BRIDGE_ADDRESS not set in .env - deploy EVM bridge first");

const main = async () => {
    const value = process.argv[2] ? parseInt(process.argv[2]) : 42;

    if (value < 0 || value > 255) {
        console.error("Value must be between 0 and 255");
        process.exit(1);
    }

    console.log(`Connecting to Arbitrum Sepolia...`);
    const { account, publicClient, walletClient } = createEvmClients(ARBITRUM_RPC_URL!, EVM_PRIVATE_KEY!);
    const bridgeAddress = getAddress(EVM_BRIDGE_ADDRESS!);

    console.log(`Using account: ${account.address}`);
    console.log(`Bridge address: ${bridgeAddress}`);

    // Get the Wormhole message fee
    const messageFee = await publicClient.readContract({
        address: bridgeAddress,
        abi: MESSAGE_BRIDGE_ABI,
        functionName: "getMessageFee",
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

    // Parse the ValueSent event to get the sequence number
    const valueSentTopic = "0x" + Buffer.from("ValueSent(address,uint16,uint8,uint64)").toString("hex");
    const valueSentEvent = receipt.logs.find(log =>
        log.address.toLowerCase() === bridgeAddress.toLowerCase()
    );

    if (valueSentEvent) {
        console.log(`\nMessage sent successfully!`);
    }

    console.log(`\nNext: Wait for the relayer to process this message and deliver it to Aztec`);
}

main().catch(console.error);
