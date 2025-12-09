# Wormhole Demo - Implementation Plan

A simplified, generalized version of the token bridge that demonstrates basic cross-chain messaging between Aztec and EVM using Wormhole.

## Overview

This project will send a simple value (1-256) bidirectionally between Aztec and EVM chains through the Wormhole protocol, demonstrating the core messaging infrastructure without the complexity of token transfers.

---

## Project Structure

```
wormhole-demo/
├── deps/                           # Git submodules (shared dependencies)
│   ├── wormhole/                   # NethermindEth/wormhole (aztec branch)
│   └── wormhole-evm/               # NethermindEth/wormhole (main/evm branch)
├── packages/
│   ├── aztec/                      # Aztec contracts & TypeScript library
│   │   ├── contracts/
│   │   │   ├── message_bridge/     # Simplified message bridge contract
│   │   │   └── wormhole/           # Symlink to deps/wormhole
│   │   ├── scripts/                # Deployment & interaction scripts
│   │   ├── src/                    # TypeScript library source
│   │   └── package.json
│   ├── evm/                        # Solidity contracts (Foundry)
│   │   ├── src/
│   │   │   └── MessageBridge.sol   # Simplified EVM bridge contract
│   │   ├── script/                 # Deployment scripts
│   │   ├── lib/                    # Foundry dependencies (symlinks to deps/)
│   │   └── foundry.toml
│   └── relayer/                    # Go-based bidirectional relayer
│       ├── cmd/                    # CLI commands (aztec, evm)
│       ├── internal/               # Relayer logic
│       └── main.go
├── .gitmodules                     # Git submodule configuration
├── package.json                    # Root workspace configuration
└── README.md
```

---

## Implementation Checklist

### Phase 1: Project Setup & Dependencies

#### 1.1 Initialize Project Structure
- [ ] Create base directory structure (`deps/`, `packages/aztec/`, `packages/evm/`, `packages/relayer/`)
- [ ] Create root `package.json` with workspace configuration
- [ ] Create `.gitignore` file
- [ ] Initialize git repository

#### 1.2 Setup Git Submodules in Top-Level deps/
- [ ] Add Wormhole submodule for Aztec: `git submodule add -b aztec https://github.com/NethermindEth/wormhole deps/wormhole`
- [ ] Add Wormhole submodule for EVM: `git submodule add https://github.com/NethermindEth/wormhole deps/wormhole-evm`
- [ ] Add OpenZeppelin submodule: `git submodule add https://github.com/openzeppelin/openzeppelin-contracts deps/openzeppelin-contracts`
- [ ] Initialize submodules: `git submodule update --init --recursive`
- [ ] Create `.gitmodules` file with proper configuration

---

### Phase 2: Aztec Package

#### 2.1 Aztec Contract - Message Bridge
- [ ] Create `packages/aztec/contracts/message_bridge/` directory
- [ ] Create `Nargo.toml` with dependencies on wormhole contract
- [ ] Create symlink: `ln -s ../../../deps/wormhole packages/aztec/contracts/wormhole`
- [ ] Implement `MessageBridge.nr` contract with:
  - [ ] Storage for last received value, sender, source chain
  - [ ] `send_value(value: u8, destination_chain: u16)` - Send value to EVM
  - [ ] `receive_value(vaa: [u8])` - Process incoming VAA from EVM
  - [ ] `get_last_value()` - View function to read last received value
  - [ ] Owner/admin functions for configuration
  - [ ] Emitter registration (trust EVM bridge)
  - [ ] VAA replay protection

#### 2.2 TypeScript Library & Build Scripts
- [ ] Create `packages/aztec/package.json` with dependencies (@aztec/aztec.js, etc.)
- [ ] Create `packages/aztec/tsconfig.json`
- [ ] Create `packages/aztec/scripts/compile.ts` - Compile Noir contracts
- [ ] Create `packages/aztec/scripts/setupAccounts.ts` - Create/load Aztec wallets
- [ ] Create `packages/aztec/scripts/deploy.ts` - Deploy MessageBridge and Wormhole
- [ ] Create `packages/aztec/scripts/configure.ts` - Register emitters on both chains
- [ ] Create `packages/aztec/scripts/sendValue.ts` - Send a value to EVM
- [ ] Create TypeScript library in `packages/aztec/src/`:
  - [ ] `src/index.ts` - Main exports
  - [ ] `src/artifacts/index.ts` - Contract artifacts
  - [ ] `src/utils/` - Helper functions (encoding, decoding, etc.)
- [ ] Add build scripts to package.json:
  - [ ] `build:contracts` - Compile Noir to TypeScript artifacts
  - [ ] `build:node` - Build TS for Node.js
  - [ ] `build:browser` - Build TS for browser
  - [ ] `build:types` - Generate TypeScript definitions
  - [ ] `build:ts` - Run all TS builds
  - [ ] `build` - Full build (contracts + TS)

---

### Phase 3: EVM Package

#### 3.1 EVM Contract - Message Bridge
- [ ] Initialize Foundry project: `packages/evm/`
- [ ] Create symlinks in `packages/evm/lib/`:
  - [ ] `ln -s ../../../deps/wormhole-evm lib/wormhole`
  - [ ] `ln -s ../../../deps/openzeppelin-contracts lib/openzeppelin-contracts`
- [ ] Create `foundry.toml` with remappings
- [ ] Implement `packages/evm/src/MessageBridge.sol` with:
  - [ ] Storage for last received value, sender, source chain
  - [ ] `sendValue(uint8 value, uint16 destinationChainId)` - Send value to Aztec
  - [ ] `receiveValue(bytes memory encodedVaa)` - Process VAA from Aztec
  - [ ] `getLastValue()` - View function
  - [ ] Owner/admin functions
  - [ ] Emitter registration (trust Aztec bridge)
  - [ ] VAA replay protection via hash tracking
- [ ] Create `packages/evm/script/DeployMessageBridge.s.sol` - Foundry deployment script

#### 3.2 EVM Build & Test Setup
- [ ] Create `packages/evm/package.json` with build scripts
- [ ] Add `build` script: `forge install && forge build`
- [ ] Add `test` script: `forge test`
- [ ] Create `.env.example` with required environment variables
- [ ] Write basic unit tests in `packages/evm/test/`

---

### Phase 4: Relayer Package

#### 4.1 Go Relayer Implementation
- [ ] Create `packages/relayer/main.go` - Entry point
- [ ] Create `packages/relayer/go.mod` with dependencies
- [ ] Implement `packages/relayer/cmd/root.go` - Root CLI command
- [ ] Implement `packages/relayer/cmd/evm.go` - Relay Aztec → EVM:
  - [ ] Connect to Wormhole spy service
  - [ ] Filter for Aztec chain messages (chain ID 56)
  - [ ] Parse VAA containing value payload
  - [ ] Submit VAA to EVM MessageBridge contract
  - [ ] Handle transaction signing and submission
- [ ] Implement `packages/relayer/cmd/aztec.go` - Relay EVM → Aztec:
  - [ ] Connect to Wormhole spy service
  - [ ] Filter for EVM chain messages (chain ID 10003 for Arbitrum Sepolia)
  - [ ] Parse VAA containing value payload
  - [ ] Submit VAA to Aztec MessageBridge contract via PXE
  - [ ] Handle Aztec transaction creation
- [ ] Create `packages/relayer/internal/` packages:
  - [ ] `internal/wormhole/` - Wormhole spy client
  - [ ] `internal/aztec/` - Aztec PXE client
  - [ ] `internal/evm/` - EVM RPC client
  - [ ] `internal/types/` - Shared types and message parsing
- [ ] Create `.env.example` with relayer configuration
- [ ] Create `packages/relayer/package.json` for npm integration
- [ ] Create `packages/relayer/README.md` with usage instructions

---

### Phase 5: Integration & Testing

#### 5.1 End-to-End Testing
- [ ] Create Docker Compose setup (optional, for local sandbox)
- [ ] Test Aztec → EVM flow:
  - [ ] Deploy both contracts
  - [ ] Configure emitters on both sides
  - [ ] Send value from Aztec
  - [ ] Start relayer (evm mode)
  - [ ] Verify value received on EVM
- [ ] Test EVM → Aztec flow:
  - [ ] Send value from EVM
  - [ ] Start relayer (aztec mode)
  - [ ] Verify value received on Aztec
- [ ] Test edge cases:
  - [ ] Invalid VAA rejection
  - [ ] Replay protection
  - [ ] Unauthorized emitter rejection
  - [ ] Value bounds (1-256)

#### 5.2 Documentation
- [ ] Create comprehensive `README.md` with:
  - [ ] Project overview
  - [ ] Architecture diagram
  - [ ] Setup instructions
  - [ ] Deployment guide (sandbox & testnet)
  - [ ] Usage examples
  - [ ] Troubleshooting
- [ ] Document message payload format
- [ ] Document contract interfaces
- [ ] Create example scripts for common operations

---

### Phase 6: Polish & Cleanup

#### 6.1 Code Quality
- [ ] Add TypeScript type checking
- [ ] Add Solidity linting (solhint)
- [ ] Add Go linting (golangci-lint)
- [ ] Clean up unused code
- [ ] Add inline code documentation

#### 6.2 Developer Experience
- [ ] Create helper scripts in root `package.json`:
  - [ ] `npm run build` - Build all packages
  - [ ] `npm run deploy:local` - Deploy to local sandbox
  - [ ] `npm run deploy:testnet` - Deploy to testnet
- [ ] Add logging to relayer with different log levels
- [ ] Add CLI help messages and examples

---

## Message Payload Format

### Aztec → EVM / EVM → Aztec

```
Byte Position | Field              | Type   | Description
--------------|--------------------| -------|----------------------------------
0             | Payload ID         | u8     | Message type identifier (e.g., 99)
1-32          | Sender Address     | bytes32| Address that sent the message
33            | Value              | u8     | The value being sent (1-256)
34-35         | Source Chain ID    | u16    | Wormhole chain ID of source
36-37         | Dest Chain ID      | u16    | Wormhole chain ID of destination
```

Total: 38 bytes (simple, fixed-size payload)

---

## Chain IDs (Wormhole)

| Chain              | Wormhole Chain ID |
|--------------------|-------------------|
| Aztec              | 56                |
| Arbitrum Sepolia   | 10003             |

---

## Environment Variables Required

### Aztec Package
- `L1_RPC_URL` - Ethereum L1 RPC endpoint
- `L2_NODE_URL` - Aztec PXE endpoint
- `WORMHOLE_ADDRESS` - Deployed Wormhole contract address
- `MESSAGE_BRIDGE_ADDRESS` - Deployed MessageBridge address

### EVM Package
- `PRIVATE_KEY` - EVM wallet private key
- `WORMHOLE_ADDRESS` - Wormhole Core contract address
- `EVM_RPC_URL` - EVM RPC endpoint

### Relayer Package
- `SPY_RPC_HOST` - Wormhole spy service endpoint
- `CHAIN_ID` - Source chain ID to monitor
- `EVM_RPC_URL` - EVM RPC endpoint
- `EVM_TARGET_CONTRACT` - EVM MessageBridge address
- `PRIVATE_KEY` - EVM private key (for evm mode)
- `AZTEC_PXE_URL` - Aztec PXE endpoint
- `AZTEC_TARGET_CONTRACT` - Aztec MessageBridge address
- `AZTEC_WALLET_ADDRESS` - Aztec wallet address (for aztec mode)

---

## Success Criteria

- ✅ Project successfully sends a value from Aztec to EVM
- ✅ Project successfully sends a value from EVM to Aztec
- ✅ Both directions work independently and concurrently
- ✅ VAA replay protection works correctly
- ✅ Unauthorized emitters are rejected
- ✅ All contracts compile and deploy successfully
- ✅ Relayer runs stably and processes messages
- ✅ Documentation is clear and comprehensive

---

## Next Steps

After completing this plan:
1. Review the implementation with the team
2. Begin with Phase 1 (Project Setup)
3. Work through phases sequentially
4. Test each phase before moving to the next
5. Update this document with any changes or discoveries

---

**Last Updated:** 2025-12-09
**Status:** Planning Phase - Ready for Implementation
