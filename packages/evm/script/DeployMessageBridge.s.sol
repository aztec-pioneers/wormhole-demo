// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {MessageBridge} from "../src/MessageBridge.sol";

contract DeployMessageBridge is Script {
    function run() external returns (MessageBridge) {
        // Read environment variables
        address wormholeAddress = vm.envAddress("WORMHOLE_ADDRESS");
        uint16 chainId = uint16(vm.envUint("CHAIN_ID"));
        uint256 evmChainId = block.chainid;
        uint8 consistency = uint8(vm.envUint("CONSISTENCY"));

        console.log("Deploying MessageBridge with:");
        console.log("  Wormhole address:", wormholeAddress);
        console.log("  Chain ID (Wormhole):", chainId);
        console.log("  EVM Chain ID:", evmChainId);
        console.log("  Consistency:", consistency);

        // Deploy contract
        vm.startBroadcast();
        MessageBridge bridge = new MessageBridge(
            wormholeAddress,
            chainId,
            evmChainId,
            consistency
        );
        vm.stopBroadcast();

        console.log("MessageBridge deployed at:", address(bridge));
        console.log("Owner:", bridge.owner());

        return bridge;
    }
}
