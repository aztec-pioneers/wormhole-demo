// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IWormhole} from "wormhole/ethereum/contracts/interfaces/IWormhole.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MessageBridge
 * @dev Simplified cross-chain messaging bridge using Wormhole
 *
 * Sends simple values (uint8: 1-256) between Aztec and EVM chains.
 *
 * Payload format (38 bytes):
 * - Byte 0:      Payload ID (99)
 * - Bytes 1-32:  Sender address (32 bytes)
 * - Byte 33:     Value (1 byte)
 * - Bytes 34-35: Source chain ID (2 bytes, big-endian)
 * - Bytes 36-37: Destination chain ID (2 bytes, big-endian)
 */
contract MessageBridge is Ownable {
    // ============================================================================
    // STATE
    // ============================================================================

    // Payload ID for simple value messages
    uint8 public constant PAYLOAD_ID_MESSAGE = 99;

    // Wormhole contract
    IWormhole public immutable wormhole;

    // Wormhole chain ID for this contract
    uint16 public immutable chainId;

    // Native EVM chain ID (for fork detection)
    uint256 public immutable evmChainId;

    // Consistency level for outbound messages
    uint8 public immutable finality;

    // Registered emitters: remoteChainId => emitterAddress
    mapping(uint16 => bytes32) public registeredEmitters;

    // Processed VAAs for replay protection: vaaHash => processed
    mapping(bytes32 => bool) public processedVaas;

    // Nonce for outbound messages
    uint32 public outboundNonce;

    // Last received message data
    uint8 public lastReceivedValue;
    uint16 public lastReceivedFromChain;
    bytes32 public lastReceivedSender;

    // ============================================================================
    // EVENTS
    // ============================================================================

    event EmitterRegistered(uint16 indexed chainId, bytes32 emitterAddress);
    event ValueSent(
        address indexed sender,
        uint16 destinationChainId,
        uint8 value,
        uint64 sequence
    );
    event ValueReceived(
        uint16 indexed sourceChainId,
        bytes32 indexed sender,
        uint8 value
    );

    // ============================================================================
    // CONSTRUCTOR
    // ============================================================================

    /**
     * @param wormholeAddr Address of the Wormhole core contract
     * @param chainId_ Wormhole chain ID for this bridge
     * @param evmChainId_ Native EVM chain ID
     * @param finality_ Consistency level for outbound messages
     */
    constructor(
        address wormholeAddr,
        uint16 chainId_,
        uint256 evmChainId_,
        uint8 finality_
    ) Ownable(msg.sender) {
        require(wormholeAddr != address(0), "Wormhole address cannot be zero");
        require(finality_ > 0, "Finality must be greater than zero");

        wormhole = IWormhole(wormholeAddr);
        chainId = chainId_;
        evmChainId = evmChainId_;
        finality = finality_;
        outboundNonce = 0;
    }

    // ============================================================================
    // MODIFIERS
    // ============================================================================

    modifier notFork() {
        require(evmChainId == block.chainid, "Cannot operate on forked chain");
        _;
    }

    // ============================================================================
    // ADMIN FUNCTIONS
    // ============================================================================

    /**
     * @notice Register an emitter from a remote chain
     * @param remoteChainId Wormhole chain ID of the remote chain
     * @param emitterAddress Emitter address as bytes32
     */
    function registerEmitter(uint16 remoteChainId, bytes32 emitterAddress) external onlyOwner {
        require(emitterAddress != bytes32(0), "Emitter cannot be zero");
        registeredEmitters[remoteChainId] = emitterAddress;
        emit EmitterRegistered(remoteChainId, emitterAddress);
    }

    // ============================================================================
    // SEND VALUE (EVM -> Aztec)
    // ============================================================================

    /**
     * @notice Send a value to a remote chain
     * @param destinationChainId Wormhole chain ID of the destination
     * @param value The value to send (0-255, where 0 = 256)
     * @return sequence The Wormhole sequence number
     */
    function sendValue(
        uint16 destinationChainId,
        uint8 value
    ) external payable notFork returns (uint64 sequence) {
        // Encode the payload
        bytes memory payload = _encodePayload(
            _addressToBytes32(msg.sender),
            value,
            chainId,
            destinationChainId
        );

        // Get the message fee
        uint256 messageFee = wormhole.messageFee();
        require(msg.value >= messageFee, "Insufficient fee for Wormhole message");

        // Publish the message
        sequence = wormhole.publishMessage{value: messageFee}(
            outboundNonce,
            payload,
            finality
        );

        // Increment nonce
        outboundNonce++;

        // Refund excess fee
        if (msg.value > messageFee) {
            (bool success, ) = msg.sender.call{value: msg.value - messageFee}("");
            require(success, "Fee refund failed");
        }

        emit ValueSent(msg.sender, destinationChainId, value, sequence);
    }

    // ============================================================================
    // RECEIVE VALUE (Aztec -> EVM)
    // ============================================================================

    /**
     * @notice Receive a value from a remote chain via VAA
     * @param encodedVaa The encoded VAA from Wormhole guardians
     */
    function receiveValue(bytes calldata encodedVaa) external notFork {
        // Parse and verify the VAA
        (IWormhole.VM memory vm, bool valid, string memory reason) = wormhole.parseAndVerifyVM(encodedVaa);
        require(valid, reason);

        // Check emitter is registered
        require(
            registeredEmitters[vm.emitterChainId] == vm.emitterAddress,
            "Unknown emitter"
        );

        // Check replay protection
        require(!processedVaas[vm.hash], "VAA already processed");
        processedVaas[vm.hash] = true;

        // Decode the payload
        require(vm.payload.length >= 38, "Invalid payload length");
        uint8 payloadId = uint8(vm.payload[0]);
        require(payloadId == PAYLOAD_ID_MESSAGE, "Invalid payload ID");

        bytes32 sender;
        uint8 value;
        uint16 sourceChainId;
        uint16 destChainId;

        assembly {
            // vm.payload is at offset 128 in the VM struct
            let payload := mload(add(vm, 128))

            // Sender is at bytes 1-32 (after payload ID)
            sender := mload(add(add(payload, 32), 1))

            // Value is at byte 33
            value := byte(0, mload(add(add(payload, 32), 33)))

            // Source chain ID is at bytes 34-35 (big-endian)
            sourceChainId := shr(240, mload(add(add(payload, 32), 34)))

            // Destination chain ID is at bytes 36-37 (big-endian)
            destChainId := shr(240, mload(add(add(payload, 32), 36)))
        }

        // Verify destination chain
        require(destChainId == chainId, "Wrong destination chain");

        // Store the received message
        lastReceivedValue = value;
        lastReceivedFromChain = sourceChainId;
        lastReceivedSender = sender;

        emit ValueReceived(sourceChainId, sender, value);
    }

    // ============================================================================
    // VIEW FUNCTIONS
    // ============================================================================

    /**
     * @notice Get the last received message data
     * @return value The last received value
     * @return fromChain The chain ID that sent the message
     * @return sender The address that sent the message
     */
    function getLastMessage() external view returns (uint8 value, uint16 fromChain, bytes32 sender) {
        return (lastReceivedValue, lastReceivedFromChain, lastReceivedSender);
    }

    function getMessageFee() external view returns (uint256) {
        return wormhole.messageFee();
    }

    // ============================================================================
    // INTERNAL FUNCTIONS
    // ============================================================================

    /**
     * @dev Encode message payload
     */
    function _encodePayload(
        bytes32 sender,
        uint8 value,
        uint16 sourceChainId,
        uint16 destinationChainId
    ) internal pure returns (bytes memory) {
        return abi.encodePacked(
            PAYLOAD_ID_MESSAGE,  // 1 byte
            sender,              // 32 bytes
            value,               // 1 byte
            sourceChainId,       // 2 bytes
            destinationChainId   // 2 bytes
        );
        // Total: 38 bytes
    }

    /**
     * @dev Convert address to bytes32 (left-padded)
     */
    function _addressToBytes32(address addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }
}
