// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {
    BytesLib
} from "wormhole/ethereum/contracts/libraries/external/BytesLib.sol";
import {IWormhole} from "wormhole/ethereum/contracts/interfaces/IWormhole.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MessageBridge
 * @dev Cross-chain messaging bridge using Wormhole for multi-chain communication
 *
 * This contract runs on Arbitrum Sepolia and receives cross-chain messages from
 * multiple sources (Aztec, Solana, other EVMs).
 *
 * Supports two payload formats based on registered emitter type:
 *
 * Aztec Payload (50 bytes, isDefaultPayload=false):
 *   - Bytes 0-31:  txId (32 bytes, added by Aztec Guardian)
 *   - Bytes 32-33: destinationChainId (big-endian)
 *   - Bytes 34-49: value (uint128, big-endian)
 *
 * Default Payload (18 bytes, isDefaultPayload=true):
 *   - Bytes 0-1:   destinationChainId (big-endian)
 *   - Bytes 2-17:  value (uint128, big-endian)
 */
contract MessageBridge is Ownable {
    using BytesLib for bytes;

    // ============================================================================
    // STATE
    // ============================================================================

    // Wormhole contract
    IWormhole public immutable WORMHOLE;

    // Wormhole chain ID for this contract (10003 = Arbitrum Sepolia)
    uint16 public immutable CHAIN_ID;

    // Native EVM chain ID (421614 = Arbitrum Sepolia)
    uint256 public immutable EVM_CHAIN_ID;

    // Consistency level for outbound messages
    uint8 public immutable CONSISTENCY;

    // Registered emitters: remoteChainId => emitterAddress (one emitter per chain)
    mapping(uint16 => bytes32) public registeredEmitters;

    // Processed messages for replay protection
    // For Aztec: nullifiers[keccak256(txId)]
    // For default: nullifiers[keccak256(emitterChainId, sequence)]
    mapping(bytes32 => bool) public nullifiers;

    // Track which emitters use default (18-byte) vs Aztec (50-byte) payload format
    // true = default payload (Solana, EVM), false = Aztec payload (with txId)
    mapping(uint16 => bool) public isDefaultPayload;

    // Nonce for outbound messages
    uint32 public outboundNonce;

    // Current value set via message passing
    uint128 public currentValue;

    // ============================================================================
    // EVENTS
    // ============================================================================

    event EmitterRegistered(uint16 indexed chainId, bytes32 emitterAddress);
    event ValueReceived(uint128 value);
    event ValueSent(uint16 indexed destinationChainId, uint128 value, uint64 sequence);

    // ============================================================================
    // CONSTRUCTOR
    // ============================================================================

    /**
     * @param wormholeAddr Address of the Wormhole core contract
     * @param chainId_ Wormhole chain ID for this bridge (10003 = Arbitrum Sepolia)
     * @param evmChainId_ Native EVM chain ID (421614 = Arbitrum Sepolia)
     * @param consistency_ Consistency level for outbound messages
     */
    constructor(
        address wormholeAddr,
        uint16 chainId_,
        uint256 evmChainId_,
        uint8 consistency_
    ) Ownable(msg.sender) {
        require(wormholeAddr != address(0), "Wormhole address cannot be zero");
        require(consistency_ > 0, "Consistency must be greater than zero");

        WORMHOLE = IWormhole(wormholeAddr);
        CHAIN_ID = chainId_;
        EVM_CHAIN_ID = evmChainId_;
        CONSISTENCY = consistency_;
        outboundNonce = 0;
    }

    // ============================================================================
    // MODIFIERS
    // ============================================================================

    modifier notFork() {
        _notFork();
        _;
    }

    function _notFork() internal view {
        require(EVM_CHAIN_ID == block.chainid, "Cannot operate on forked chain");
    }

    // ============================================================================
    // ADMIN FUNCTIONS
    // ============================================================================

    /**
     * @notice Register an emitter from a remote chain
     * @param remoteChainId Wormhole chain ID of the remote chain (e.g., 56 for Aztec)
     * @param emitterAddress Emitter address as bytes32
     * @param _isDefaultPayload true for default 18-byte payloads (Solana/EVM), false for Aztec 50-byte payloads
     */
    function registerEmitter(
        uint16 remoteChainId,
        bytes32 emitterAddress,
        bool _isDefaultPayload
    ) external onlyOwner {
        require(emitterAddress != bytes32(0), "Emitter cannot be zero");
        registeredEmitters[remoteChainId] = emitterAddress;
        isDefaultPayload[remoteChainId] = _isDefaultPayload;
        emit EmitterRegistered(remoteChainId, emitterAddress);
    }

    // ============================================================================
    // SEND VALUE (EVM -> Aztec)
    // ============================================================================

    /**
     * @notice Send a value to a remote chain
     * @param destinationChainId Wormhole chain ID of the destination
     * @param value The value to send (uint128)
     * @return sequence The Wormhole sequence number
     */
    function sendValue(
        uint16 destinationChainId,
        uint128 value
    ) external payable notFork returns (uint64 sequence) {
        bytes memory payload = _encodePayload(value, destinationChainId);

        uint256 messageFee = WORMHOLE.messageFee();
        require(
            msg.value >= messageFee,
            "Insufficient fee for Wormhole message"
        );

        sequence = WORMHOLE.publishMessage{value: messageFee}(
            outboundNonce,
            payload,
            CONSISTENCY
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
     * @notice Receive and process a cross-chain message
     * @param encodedVm The encoded Wormhole VAA
     *
     * Routes to appropriate processor based on registered emitter type:
     * - isDefaultPayload[chainId] == true: Default format (18 bytes from Solana/EVM)
     * - isDefaultPayload[chainId] == false: Aztec format (50 bytes with txId)
     */
    function receiveValue(bytes memory encodedVm) external notFork {
        IWormhole.VM memory vm = _verify(encodedVm);

        if (isDefaultPayload[vm.emitterChainId]) {
            // Default payload from Solana/EVM: [chainId(2) | value(16)]
            _processDefaultPayload(vm.payload, vm.emitterChainId, vm.sequence);
        } else {
            // Aztec payload: [txId(32) | chainId(2) | value(16)]
            _processAztecPayload(vm.payload);
        }
    }

    /**
     * @dev Internal verification function for VAAs
     * @return vm The parsed and verified VAA
     */
    function _verify(
        bytes memory encodedVm
    ) internal view returns (IWormhole.VM memory) {
        (IWormhole.VM memory vm, bool valid, string memory reason) = WORMHOLE
            .parseAndVerifyVM(encodedVm);

        require(valid, reason);
        require(
            _verifyAuthorizedEmitter(vm),
            "Invalid emitter: source not recognized"
        );

        return vm;
    }

    /**
     * @dev Process Aztec payload (50 bytes with txId prepended by Guardian)
     * Format: [txId(32) | destinationChainId(2) | value(16)]
     * Aztec Guardian prepends the source transaction ID for replay protection
     */
    function _processAztecPayload(bytes memory payload) internal {
        require(payload.length >= 50, "Aztec payload too short");

        // Extract txId from first 32 bytes (added by Aztec Guardian)
        bytes32 txId;
        assembly {
            txId := mload(add(payload, 32))
        }
        require(txId != bytes32(0), "Invalid txId");

        // Replay protection: hash txId for consistency with default format
        bytes32 nullifier = keccak256(abi.encodePacked(txId));
        require(!nullifiers[nullifier], "Already processed");
        nullifiers[nullifier] = true;

        // Value is at bytes 34-49 (16 bytes, big-endian)
        uint128 value;
        assembly {
            value := shr(128, mload(add(add(payload, 32), 34)))
        }

        currentValue = value;
        emit ValueReceived(value);
    }

    /**
     * @dev Process default payload (18 bytes without txId)
     * Format: [destinationChainId(2) | value(16)]
     * Used for chains that don't add txId (Solana, other EVMs)
     * Uses emitterChainId + sequence as replay protection key
     */
    function _processDefaultPayload(
        bytes memory payload,
        uint16 emitterChainId,
        uint64 sequence
    ) internal {
        require(payload.length >= 18, "Default payload too short");

        // Replay protection: hash chain + sequence
        bytes32 nullifier = keccak256(abi.encodePacked(emitterChainId, sequence));
        require(!nullifiers[nullifier], "Already processed");
        nullifiers[nullifier] = true;

        // Value is at bytes 2-17 (16 bytes, big-endian)
        uint128 value;
        assembly {
            value := shr(128, mload(add(add(payload, 32), 2)))
        }

        currentValue = value;
        emit ValueReceived(value);
    }

    /**
     * @dev Verifies that a VAA is from a registered authorized emitter
     */
    function _verifyAuthorizedEmitter(
        IWormhole.VM memory vm
    ) internal view returns (bool) {
        return registeredEmitters[vm.emitterChainId] == vm.emitterAddress;
    }

    // ============================================================================
    // VIEW FUNCTIONS
    // ============================================================================

    // ============================================================================
    // INTERNAL FUNCTIONS
    // ============================================================================

    function _encodePayload(
        uint128 value,
        uint16 destinationChainId
    ) internal pure returns (bytes memory) {
        return
            abi.encodePacked(
                destinationChainId, // 2 bytes
                value // 16 bytes
            );
        // Total: 18 bytes
    }

}
