// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {
    BytesLib
} from "wormhole/ethereum/contracts/libraries/external/BytesLib.sol";
import {IWormhole} from "wormhole/ethereum/contracts/interfaces/IWormhole.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MessageBridge
 * @dev Cross-chain messaging bridge using Wormhole for Aztec <-> EVM communication
 *
 * This contract runs on Arbitrum Sepolia and receives cross-chain messages from Aztec.
 *
 * Aztec Guardian Payload Structure (after zero-stripping and byte reversal):
 *   - Bytes 0-31:  txId (32 bytes, added by guardian)
 *   - Byte 32:     messageId (PAYLOAD_ID_MESSAGE = 99)
 *   - Bytes 33-34: sourceChainId (big-endian)
 *   - Bytes 35-36: destinationChainId (big-endian)
 *   - Bytes 37-68: sender (32 bytes)
 *   - Bytes 69-73: padding (5 bytes of zeros)
 *   - Byte 74:     value
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

    // Registered emitters: remoteChainId => emitterAddress => bool
    mapping(uint16 => mapping(bytes32 => bool)) public registeredEmitters;

    // Processed messages for replay protection: txId => value
    // Non-zero value means processed
    mapping(bytes32 => bool) public nullifiers;

    // Nonce for outbound messages
    uint32 public outboundNonce;

    // Current value set via message passing
    uint8 public currentValue;

    // ============================================================================
    // EVENTS
    // ============================================================================

    event EmitterRegistered(uint16 indexed chainId, bytes32 emitterAddress);
    event ValueReceived(
        uint16 indexed sourceChainId,
        bytes32 indexed sender,
        uint8 value
    );
    event ValueSent(
        address indexed sender,
        uint16 destinationChainId,
        uint8 value,
        uint64 sequence
    );

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
        registeredEmitters[remoteChainId][emitterAddress] = true;
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
        require(
            msg.value >= messageFee,
            "Insufficient fee for Wormhole message"
        );

        sequence = wormhole.publishMessage{value: messageFee}(
            outboundNonce,
            payload,
            finality
        );

        outboundNonce++;

        if (msg.value > messageFee) {
            (bool success, ) = msg.sender.call{value: msg.value - messageFee}(
                ""
            );
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
    function _verify(
        bytes memory encodedVm
    ) internal view returns (bytes memory) {
        (IWormhole.VM memory vm, bool valid, string memory reason) = wormhole
            .parseAndVerifyVM(encodedVm);

        require(valid, reason);
        require(
            _verifyAuthorizedEmitter(vm),
            "Invalid emitter: source not recognized"
        );

        return vm.payload;
    }

    function _processPayload(bytes memory payload) internal {

        // Actual payload structure from Aztec Guardian (after zero-stripping and reversal):
        // Bytes 0-31:  txId (32 bytes)
        // Byte 32:     messageId
        // Bytes 33-34: sourceChainId (big-endian)
        // Bytes 35-36: destinationChainId (big-endian)
        // Bytes 37-68: sender (32 bytes, contiguous)
        // Bytes 69-73: padding zeros (5 bytes)
        // Byte 74:     value
        // Minimum: 75 bytes to reach value
        require(payload.length >= 75, "Payload too short");

        // Extract txId from first 32 bytes (added by Aztec Guardian)
        bytes32 txId;
        assembly {
            txId := mload(add(payload, 32))
        }
        require(txId != bytes32(0), "Invalid txId");

        // Check if already processed & nullify
        require(nullifiers[txId] == false, "Already processed");
        nullifiers[txId] = true;

        uint8 messageId = uint8(payload[32]);

        uint16 sourceChainId = (uint16(uint8(payload[33])) << 8) |
            uint16(uint8(payload[34]));
        uint16 destinationChainId = (uint16(uint8(payload[35])) << 8) |
            uint16(uint8(payload[36]));

        // Extract sender - contiguous 32 bytes starting at byte 37
        bytes32 sender;
        assembly {
            let ptr := add(payload, 32) // skip length prefix
            // sender starts at byte 37 = ptr + 37
            sender := mload(add(ptr, 37))
        }

        // Value is at byte 74 (after txId + messageId + chains + sender + padding)
        uint8 value = uint8(payload[74]);

        currentValue = value;
        emit ValueReceived(sourceChainId, sender, value);
    }

    /**
     * @dev Verifies that a VAA is from a registered authorized emitter
     */
    function _verifyAuthorizedEmitter(
        IWormhole.VM memory vm
    ) internal view returns (bool) {
        return registeredEmitters[vm.emitterChainId][vm.emitterAddress];
    }

    // ============================================================================
    // VIEW FUNCTIONS
    // ============================================================================

    // ============================================================================
    // INTERNAL FUNCTIONS
    // ============================================================================

    function _encodePayload(
        bytes32 sender,
        uint8 value,
        uint16 sourceChainId,
        uint16 destinationChainId
    ) internal pure returns (bytes memory) {
        return
            abi.encodePacked(
                PAYLOAD_ID_MESSAGE, // 1 byte
                sourceChainId, // 2 bytes
                destinationChainId, // 2 bytes
                sender, // 32 bytes
                value // 1 byte
            );
        // Total: 38 bytes
    }

    function _addressToBytes32(address addr) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(addr)));
    }
}
