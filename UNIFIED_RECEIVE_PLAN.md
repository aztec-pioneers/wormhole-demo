# Unified receiveValue: Handle All Source Chains

## Goal
Modify EVM and Solana bridges to handle messages from ANY source chain using explicit emitter type registration. Each emitter is registered with its payload format type.

## Payload Formats
- **Aztec (50 bytes)**: `[txId(32) | chainId(2) | value(16)]` - Guardian prepends txId
- **Default (18 bytes)**: `[chainId(2) | value(16)]` - Used by Solana/EVM

## Replay Protection (Single `nullifiers` mapping, all hashed)
- **Aztec**: `nullifiers[keccak256(txId)]`
- **Default**: `nullifiers[keccak256(emitterChainId, sequence)]`

---

## EVM Changes

### `packages/evm/src/MessageBridge.sol`

- [x] Add `isDefaultPayload` storage mapping
  ```solidity
  mapping(uint16 => bool) public isDefaultPayload;
  ```

- [x] Update `registerEmitter` to accept `_isDefaultPayload` param
  ```solidity
  function registerEmitter(
      uint16 remoteChainId,
      bytes32 emitterAddress,
      bool _isDefaultPayload  // true for Solana/EVM, false for Aztec
  ) external onlyOwner
  ```

- [x] Modify `_verify` to return full `IWormhole.VM memory` (not just payload)

- [x] Rename `_processPayload` → `_processAztecPayload`
  - Hash txId for nullifier: `keccak256(abi.encodePacked(txId))`
  - Add docstring explaining Aztec format

- [x] Add `_processDefaultPayload` function
  - Hash chain+sequence for nullifier: `keccak256(abi.encodePacked(emitterChainId, sequence))`
  - Add docstring explaining default format

- [x] Update `receiveValue` to route based on `isDefaultPayload[chainId]`
  ```solidity
  if (isDefaultPayload[vm.emitterChainId]) {
      _processDefaultPayload(vm.payload, vm.emitterChainId, vm.sequence);
  } else {
      _processAztecPayload(vm.payload);
  }
  ```

### `packages/evm/test/MessageBridge.t.sol`

- [x] Update tests for new `registerEmitter` signature
- [ ] Add tests for Aztec payload processing
- [ ] Add tests for default payload processing
- [ ] Add tests for replay protection (both formats)

---

## Solana Changes

### `packages/solana/message_bridge/programs/message_bridge/src/lib.rs`

- [x] Add `is_default_payload: bool` to `ForeignEmitter` account struct

- [x] Update `register_emitter` instruction to accept `is_default_payload` param

- [x] Update `receive_value` to use emitter type instead of payload size
  ```rust
  if foreign_emitter.is_default_payload {
      ValueMessage::decode(payload)
  } else {
      InboundMessage::decode(payload)
  }
  ```

### `packages/solana/ts/src/client.ts`

- [x] Update `registerEmitter` method to accept `isDefaultPayload` param
- [x] Update instruction builder
- [x] Update `getForeignEmitter` to return `isDefaultPayload` field

### `packages/solana/ts/src/types.ts`

- [x] Add `isDefaultPayload: boolean` to `ForeignEmitter` interface

### Solana Tests

- [ ] Update tests for new `register_emitter` signature
- [ ] Add tests for both payload formats

---

## Script Updates

- [x] Update `scripts/registerEmitters.ts` to pass `isDefaultPayload`:
  - Aztec emitter: `isDefaultPayload = false` (50-byte payload with txId)
  - Solana emitter: `isDefaultPayload = true` (18-byte default payload)
  - EVM emitter: `isDefaultPayload = true` (18-byte default payload)

---

## Testing Checklist

- [ ] EVM can receive from Aztec (50-byte payload with txId)
- [ ] EVM can receive from Solana (18-byte payload)
- [ ] Solana can receive from Aztec (50-byte payload with txId)
- [ ] Solana can receive from EVM (18-byte payload)
- [ ] Replay protection works for Aztec messages
- [ ] Replay protection works for default messages
- [ ] Same (chain, sequence) from different chains doesn't collide

---

## Progress Notes

- Started: 2025-12-12
- EVM complete: 2025-12-12
  - Added `isDefaultPayload` mapping
  - Updated `registerEmitter` signature
  - Modified `_verify` to return full VM
  - Added `_processAztecPayload` (50-byte with txId, hashed nullifier)
  - Added `_processDefaultPayload` (18-byte, chain+sequence nullifier)
  - Updated `receiveValue` to route based on emitter type
- Solana complete: 2025-12-12
  - Added `is_default_payload` to `ForeignEmitter` account
  - Updated `register_emitter` instruction
  - Updated `receive_value` to use emitter type
  - Updated TypeScript client
- Scripts complete: 2025-12-12
  - Updated `registerEmitters.ts` with isDefaultPayload args
- Testing: TODO
