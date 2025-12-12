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
 *   - Bytes 32-33: destinationChainId (big-endian)
 *   - Byte 34:     value
 */
contract MessageBridge is Ownable {
    using BytesLib for bytes;

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
    event ValueReceived(uint8 value);
    event ValueSent(uint16 indexed destinationChainId, uint8 value, uint64 sequence);

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
     * @param value The value to send (0-255)
     * @return sequence The Wormhole sequence number
     */
    function sendValue(
        uint16 destinationChainId,
        uint8 value
    ) external payable notFork returns (uint64 sequence) {
        bytes memory payload = _encodePayload(value, destinationChainId);

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

        emit ValueSent(destinationChainId, value, sequence);
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
        // Bytes 0-31:  txId (32 bytes, added by guardian)
        // Bytes 32-33: destinationChainId (big-endian)
        // Byte 34:     value
        // Minimum: 35 bytes
        require(payload.length >= 35, "Payload too short");

        // Extract txId from first 32 bytes (added by Aztec Guardian)
        bytes32 txId;
        assembly {
            txId := mload(add(payload, 32))
        }
        require(txId != bytes32(0), "Invalid txId");

        // Check if already processed & nullify
        require(nullifiers[txId] == false, "Already processed");
        nullifiers[txId] = true;

        // destinationChainId (2 bytes, big-endian) - not used but parsed for validation
        // uint16 destinationChainId = (uint16(uint8(payload[32])) << 8) |
        //     uint16(uint8(payload[33]));

        // Value is at byte 34
        uint8 value = uint8(payload[34]);

        currentValue = value;
        emit ValueReceived(value);
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
        uint8 value,
        uint16 destinationChainId
    ) internal pure returns (bytes memory) {
        return
            abi.encodePacked(
                destinationChainId, // 2 bytes
                value // 1 byte
            );
        // Total: 3 bytes
    }

}
