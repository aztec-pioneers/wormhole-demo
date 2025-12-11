// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BytesLib} from "wormhole/ethereum/contracts/libraries/external/BytesLib.sol";
import {IWormhole} from "wormhole/ethereum/contracts/interfaces/IWormhole.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MessageBridge
 * @dev Cross-chain messaging bridge using Wormhole for Aztec <-> EVM communication
 *
 * This contract runs on Arbitrum Sepolia and receives cross-chain messages from Aztec.
 *
 * Aztec Wormhole Payload Structure:
 * The Aztec Wormhole contract emits a public log with 13 Fields:
 *   - Fields 0-4: Header (sender, sequence, nonce, consistency, timestamp) = 160 bytes
 *   - Fields 5-12: Message payload in 31-byte chunks (little-endian reversed)
 *
 * The Aztec side encodes:
 *   - Chunk 0: [value, srcChainHi, srcChainLo, dstChainHi, dstChainLo, payloadId, zeros...]
 *   - Chunk 1: [sender bytes 0-30]
 *   - Chunk 2: [sender byte 31, zeros...]
 *
 * After LE reversal, value is at byte 191 (160 header + 31 end of Field 5)
 */
contract MessageBridge is Ownable {
    using BytesLib for bytes;

    // ============================================================================
    // CONSTANTS
    // ============================================================================

    // Payload ID for simple value messages
    uint8 public constant PAYLOAD_ID_MESSAGE = 99;

    // ============================================================================
    // STATE
    // ============================================================================

    // Wormhole contract
    IWormhole public immutable wormhole;

    // Wormhole chain ID for this contract (10003 = Arbitrum Sepolia)
    uint16 public immutable chainId;

    // Native EVM chain ID (421614 = Arbitrum Sepolia)
    uint256 public immutable evmChainId;

    // Consistency level for outbound messages
    uint8 public immutable finality;

    // Registered emitters: remoteChainId => emitterAddress
    mapping(uint16 => bytes32) public registeredEmitters;

    // Processed messages for replay protection: txId => value
    // Non-zero value means processed
    mapping(bytes32 => uint256) public processedMessages;

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
    event MessageStored(bytes32 indexed sender, bytes32 indexed txId, uint256 payloadLength);
    event ValueReceived(uint16 indexed sourceChainId, bytes32 indexed sender, uint8 value);
    event ValueSent(address indexed sender, uint16 destinationChainId, uint8 value, uint64 sequence);

    // ============================================================================
    // CONSTRUCTOR
    // ============================================================================

    /**
     * @param wormholeAddr Address of the Wormhole core contract
     * @param chainId_ Wormhole chain ID for this bridge (10003 = Arbitrum Sepolia)
     * @param evmChainId_ Native EVM chain ID (421614 = Arbitrum Sepolia)
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
     * @param remoteChainId Wormhole chain ID of the remote chain (e.g., 56 for Aztec)
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
        bytes memory payload = _encodePayload(
            _addressToBytes32(msg.sender),
            value,
            chainId,
            destinationChainId
        );

        uint256 messageFee = wormhole.messageFee();
        require(msg.value >= messageFee, "Insufficient fee for Wormhole message");

        sequence = wormhole.publishMessage{value: messageFee}(
            outboundNonce,
            payload,
            finality
        );

        outboundNonce++;

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
     * @notice Verifies a VAA and processes the message
     * @param encodedVm A byte array containing a VAA signed by the guardians
     */
    function receiveValue(bytes memory encodedVm) external notFork {
        bytes memory payload = _verify(encodedVm);
        _processPayload(payload);
    }

    /**
     * @dev Internal verification function for VAAs
     */
    function _verify(bytes memory encodedVm) internal view returns (bytes memory) {
        (IWormhole.VM memory vm, bool valid, string memory reason) = wormhole.parseAndVerifyVM(encodedVm);

        require(valid, reason);
        require(_verifyAuthorizedEmitter(vm), "Invalid emitter: source not recognized");

        return vm.payload;
    }

    /**
     * @dev Process the Aztec Wormhole payload
     *
     * Payload structure after guardian serialization (13 Fields × 32 bytes = 416 bytes):
     * - Bytes 0-31:   Field 0 = msg_sender (Wormhole contract caller = MessageBridge)
     * - Bytes 32-63:  Field 1 = sequence
     * - Bytes 64-95:  Field 2 = nonce
     * - Bytes 96-127: Field 3 = consistency
     * - Bytes 128-159: Field 4 = timestamp
     * - Bytes 160-191: Field 5 = reversed chunk 0 (value at byte 191)
     * - Bytes 192-223: Field 6 = reversed chunk 1 (sender bytes reversed)
     * - Bytes 224-255: Field 7 = reversed chunk 2
     * - ... (remaining Fields are zeros)
     *
     * Due to Field::from_le_bytes() in Aztec, the chunk bytes are reversed.
     * Chunk 0 was: [value, srcChainHi, srcChainLo, dstChainHi, dstChainLo, payloadId, ...]
     * After reversal in Field 5: [..., payloadId, dstChainLo, dstChainHi, srcChainLo, srcChainHi, value]
     * So value is at byte 191 (Field 5 byte 31)
     */
    function _processPayload(bytes memory payload) internal {
        require(evmChainId == block.chainid, "Invalid fork");

        // Minimum payload length: 192 bytes to reach value at byte 191
        require(payload.length >= 192, "Payload too short");

        // Extract txId from the first 32 bytes (Field 0 = emitter/caller address)
        bytes32 txId;
        assembly {
            txId := mload(add(payload, 32))
        }
        require(txId != bytes32(0), "Invalid txId extracted");

        // Check replay protection
        require(processedMessages[txId] == 0, "Already processed");

        // Extract value from byte 191 (last byte of Field 5)
        // payload memory layout: [length (32 bytes)][data...]
        // To read byte 191 of data: add(payload, 32 + 191) = add(payload, 223)
        // mload reads 32 bytes, byte 191 is the first byte of that read
        uint256 value;
        assembly {
            let valueData := mload(add(payload, 223))
            value := shr(248, valueData)
        }

        // After LE reversal, Field 5 layout (bytes 160-191):
        // [0(160), zeros(161-185), payloadId(186), dstLo(187), dstHi(188), srcLo(189), srcHi(190), value(191)]

        // Extract source chain ID: srcHi at 190, srcLo at 189
        uint16 sourceChainId = (uint16(uint8(payload[190])) << 8) | uint16(uint8(payload[189]));

        // Extract destination chain ID: dstHi at 188, dstLo at 187
        uint16 destChainId = (uint16(uint8(payload[188])) << 8) | uint16(uint8(payload[187]));

        // Verify destination chain
        require(destChainId == chainId, "Wrong destination chain");

        // Store the processed message
        processedMessages[txId] = value + 1; // +1 so 0 means unprocessed

        // Store last received data
        lastReceivedValue = uint8(value);
        lastReceivedFromChain = sourceChainId;
        lastReceivedSender = txId;

        emit MessageStored(txId, txId, payload.length);
        emit ValueReceived(sourceChainId, txId, uint8(value));
    }

    /**
     * @dev Verifies that a VAA is from a registered authorized emitter
     */
    function _verifyAuthorizedEmitter(IWormhole.VM memory vm) internal view returns (bool) {
        bytes32 registeredEmitter = registeredEmitters[vm.emitterChainId];
        return registeredEmitter == vm.emitterAddress;
    }

    // ============================================================================
    // VIEW FUNCTIONS
    // ============================================================================

    function getLastMessage() external view returns (uint8 value, uint16 fromChain, bytes32 sender) {
        return (lastReceivedValue, lastReceivedFromChain, lastReceivedSender);
    }

    function getProcessedMessage(bytes32 txId) public view returns (uint256) {
        return processedMessages[txId];
    }

    function getRegisteredEmitter(uint16 remoteChainId) external view returns (bytes32) {
        return registeredEmitters[remoteChainId];
    }

    function getMessageFee() external view returns (uint256) {
        return wormhole.messageFee();
    }

    // ============================================================================
    // INTERNAL FUNCTIONS
    // ============================================================================

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

    function _addressToBytes32(address addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }
}
