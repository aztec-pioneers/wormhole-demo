// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {MessageBridge} from "../src/MessageBridge.sol";

contract MockWormhole {
    uint32 private sequence;
    uint256 public messageFee;

    function publishMessage(
        uint32 /* nonce */,
        bytes memory /* payload */,
        uint8 /* consistencyLevel */
    ) external payable returns (uint64) {
        require(msg.value >= messageFee, "Insufficient fee");
        return uint64(sequence++);
    }

    function setMessageFee(uint256 fee) external {
        messageFee = fee;
    }

    function parseAndVerifyVM(bytes calldata /* encodedVM */)
        external
        view
        returns (
            IWormhole.VM memory vm,
            bool valid,
            string memory reason
        )
    {
        // Mock implementation - in real tests, this would verify signatures
        valid = true;
        reason = "";

        // Return empty VM for now - full tests would decode actual VAAs
        vm = IWormhole.VM({
            version: 1,
            timestamp: uint32(block.timestamp),
            nonce: 0,
            emitterChainId: 0,
            emitterAddress: bytes32(0),
            sequence: 0,
            consistencyLevel: 0,
            payload: "",
            guardianSetIndex: 0,
            signatures: new IWormhole.Signature[](0),
            hash: bytes32(0)
        });
    }
}

// Import IWormhole interface for the mock
interface IWormhole {
    struct Signature {
        bytes32 r;
        bytes32 s;
        uint8 v;
        uint8 guardianIndex;
    }

    struct VM {
        uint8 version;
        uint32 timestamp;
        uint32 nonce;
        uint16 emitterChainId;
        bytes32 emitterAddress;
        uint64 sequence;
        uint8 consistencyLevel;
        bytes payload;
        uint32 guardianSetIndex;
        Signature[] signatures;
        bytes32 hash;
    }

    function publishMessage(
        uint32 nonce,
        bytes memory payload,
        uint8 consistencyLevel
    ) external payable returns (uint64 sequence);

    function parseAndVerifyVM(bytes calldata encodedVM)
        external
        view
        returns (
            VM memory vm,
            bool valid,
            string memory reason
        );
}

contract MessageBridgeTest is Test {
    MessageBridge public bridge;
    MockWormhole public mockWormhole;

    address public owner;
    address public user;

    uint16 constant WORMHOLE_CHAIN_ID = 10003; // Arbitrum Sepolia
    uint8 constant CONSISTENCY = 200;

    function setUp() public {
        owner = address(this);
        user = makeAddr("user");

        // Deploy mock Wormhole
        mockWormhole = new MockWormhole();
        mockWormhole.setMessageFee(0);

        // Deploy MessageBridge (use current chain ID to avoid fork check)
        bridge = new MessageBridge(
            address(mockWormhole),
            WORMHOLE_CHAIN_ID,
            block.chainid,
            CONSISTENCY
        );
    }

    function test_Constructor() public view {
        assertEq(address(bridge.WORMHOLE()), address(mockWormhole));
        assertEq(bridge.CHAIN_ID(), WORMHOLE_CHAIN_ID);
        assertEq(bridge.EVM_CHAIN_ID(), block.chainid);
        assertEq(bridge.CONSISTENCY(), CONSISTENCY);
        assertEq(bridge.owner(), owner);
        assertEq(bridge.outboundNonce(), 0);
    }

    function test_SendValue() public {
        uint8 value = 42;
        uint16 destChain = 56; // Aztec chain ID

        uint64 sequence = bridge.sendValue(destChain, value);
        assertEq(sequence, 0);
        assertEq(bridge.outboundNonce(), 1);
    }

    function test_SendValue_WithFee() public {
        mockWormhole.setMessageFee(1 ether);

        uint8 value = 100;
        uint16 destChain = 56;

        vm.deal(address(this), 2 ether);
        uint64 sequence = bridge.sendValue{value: 1 ether}(destChain, value);
        assertEq(sequence, 0);
    }

    function test_SendValue_RevertOnInsufficientFee() public {
        mockWormhole.setMessageFee(1 ether);

        vm.expectRevert();
        bridge.sendValue(56, 42);
    }

    function test_RegisterEmitter_Aztec() public {
        uint16 remoteChain = 56; // Aztec
        bytes32 emitterAddress = bytes32(uint256(0x1234));

        bridge.registerEmitter(remoteChain, emitterAddress, false); // Aztec uses non-default payload
        assertEq(bridge.registeredEmitters(remoteChain), emitterAddress);
        assertEq(bridge.isDefaultPayload(remoteChain), false);
    }

    function test_RegisterEmitter_Solana() public {
        uint16 remoteChain = 1; // Solana
        bytes32 emitterAddress = bytes32(uint256(0x5678));

        bridge.registerEmitter(remoteChain, emitterAddress, true); // Solana uses default payload
        assertEq(bridge.registeredEmitters(remoteChain), emitterAddress);
        assertEq(bridge.isDefaultPayload(remoteChain), true);
    }

    function test_RegisterEmitter_OnlyOwner() public {
        vm.prank(user);
        vm.expectRevert();
        bridge.registerEmitter(56, bytes32(uint256(0x1234)), false);
    }

    function test_CurrentValue_InitialState() public view {
        assertEq(bridge.currentValue(), 0);
    }

    function test_TransferOwnership() public {
        bridge.transferOwnership(user);
        assertEq(bridge.owner(), user);
    }

    function test_TransferOwnership_OnlyOwner() public {
        vm.prank(user);
        vm.expectRevert();
        bridge.transferOwnership(user);
    }
}
