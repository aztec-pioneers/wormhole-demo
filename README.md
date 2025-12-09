# Wormhole Demo - Cross-Chain Messaging

A simplified demonstration of bidirectional cross-chain messaging between Aztec and EVM using Wormhole protocol.

## Overview

This project demonstrates the core Wormhole messaging infrastructure by sending simple values (1-256) between Aztec and EVM chains. It's designed as a minimal, generalized version of the token bridge, focusing on the fundamental cross-chain messaging mechanics.

## Features

- **Bidirectional Messaging**: Send values from Aztec to EVM and vice versa
- **Simplified Contracts**: Minimal MessageBridge contracts on both chains
- **Automated Relayer**: Go-based relayer with commands for both directions
- **Complete Tooling**: Account setup, deployment, and configuration scripts
- **Git Submodules**: All Wormhole dependencies in top-level `deps/` folder

## Project Structure

```
wormhole-demo/
├── deps/                           # Git submodules (shared dependencies)
│   ├── wormhole/                   # NethermindEth/wormhole (aztec branch)
│   ├── wormhole-evm/               # NethermindEth/wormhole (main branch)
│   └── openzeppelin-contracts/     # OpenZeppelin contracts
├── packages/
│   ├── aztec/                      # Aztec contracts & TypeScript library
│   ├── evm/                        # Solidity contracts (Foundry)
│   └── relayer/                    # Go-based bidirectional relayer
├── IMPLEMENTATION_PLAN.md          # Detailed implementation checklist
└── README.md                       # This file
```

## Prerequisites

- **Node.js**: Version >=20.9.0
- **Bun**: Latest version (for package management)
- **Aztec Nargo**: For compiling Aztec contracts
- **Foundry**: For EVM contract development
- **Go**: Version >=1.21 (for the relayer)
- **Docker**: (Optional) For running local sandbox

## Getting Started

### 1. Clone with Submodules

```bash
git clone --recurse-submodules <repository-url>
cd wormhole-demo
```

**Already cloned?** Initialize submodules:
```bash
git submodule update --init --recursive
```

### 2. Install Dependencies

```bash
# Install Node.js dependencies
bun install

# Install Foundry dependencies
cd packages/evm && forge install
```

### 3. Build All Packages

```bash
# Build everything
npm run build

# Or build individually
npm run build:aztec
npm run build:evm
npm run build:relayer
```

## Local Development

### Start the Sandbox

```bash
# Start Aztec sandbox with forked Anvil
npm run sandbox
```

This starts:
- **Anvil** on `localhost:8545` (forked from Arbitrum Sepolia)
- **Aztec Node** on `localhost:8080`

### Deploy Contracts

```bash
# Deploy to local sandbox
npm run deploy:local
```

## Message Flow

### Aztec → EVM

1. User calls `sendValue(value, destinationChainId)` on Aztec MessageBridge
2. MessageBridge calls Wormhole to publish message
3. Wormhole emits message with VAA
4. Relayer (evm mode) picks up VAA from spy service
5. Relayer submits VAA to EVM MessageBridge
6. EVM MessageBridge verifies and processes message
7. Value is stored in EVM contract

### EVM → Aztec

1. User calls `sendValue(value, destinationChainId)` on EVM MessageBridge
2. MessageBridge calls Wormhole Core to publish message
3. Wormhole Core emits message with VAA
4. Relayer (aztec mode) picks up VAA from spy service
5. Relayer submits VAA to Aztec MessageBridge via PXE
6. Aztec MessageBridge verifies and processes message
7. Value is stored in Aztec contract

## Message Payload Format

```
Offset | Field              | Type    | Size | Description
-------|--------------------|---------+------+----------------------------------
0      | Payload ID         | u8      | 1    | Message type (e.g., 99)
1-32   | Sender Address     | bytes32 | 32   | Address that sent the message
33     | Value              | u8      | 1    | The value being sent (1-256)
34-35  | Source Chain ID    | u16     | 2    | Wormhole chain ID of source
36-37  | Dest Chain ID      | u16     | 2    | Wormhole chain ID of destination
```

Total: 38 bytes (fixed-size payload)

## Chain IDs (Wormhole)

| Chain            | Wormhole Chain ID |
|------------------|-------------------|
| Aztec            | 56                |
| Arbitrum Sepolia | 10003             |

## Package Details

### Aztec Package (`packages/aztec`)

Contains:
- Noir MessageBridge contract
- TypeScript library for contract interaction
- Deployment and configuration scripts
- Build tooling for contracts and TS

**Scripts:**
- `bun run build:contracts` - Compile Noir contracts
- `bun run build:ts` - Build TypeScript library
- `bun run setup:accounts` - Create wallet accounts
- `bun run setup:deploy` - Deploy contracts
- `bun run setup:configure` - Configure emitters

### EVM Package (`packages/evm`)

Contains:
- Solidity MessageBridge contract
- Foundry test suite
- Deployment scripts

**Scripts:**
- `bun run build` - Compile contracts
- `bun run test` - Run tests
- `forge script script/DeployMessageBridge.s.sol` - Deploy

### Relayer Package (`packages/relayer`)

Contains:
- Go relayer implementation
- Commands for both directions

**Commands:**
```bash
# Relay Aztec → EVM
./wormhole-relayer evm --private-key $PRIVATE_KEY

# Relay EVM → Aztec
./wormhole-relayer aztec
```

## Development Status

**Phase 1: Project Setup & Dependencies** ✅ COMPLETE
- [x] Directory structure
- [x] Git submodules
- [x] Package configuration

**Phase 2-6: Implementation** 🚧 IN PROGRESS

See [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) for detailed checklist.

## Contributing

This is a demonstration project. See the implementation plan for areas that need work.

## License

MIT

## Resources

- [Aztec Documentation](https://docs.aztec.network/)
- [Wormhole Documentation](https://docs.wormhole.com/)
- [Foundry Documentation](https://book.getfoundry.sh/)
