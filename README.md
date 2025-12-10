# Wormhole Demo - Build & Deploy

## Prerequisites

- Node.js 18+
- pnpm 9+
- Go 1.21+
- Docker & Docker Compose
- Foundry

## Setup

```bash
# Install dependencies
pnpm install

# Install Foundry dependencies
cd packages/evm && forge install
```

## Build

```bash
# Build all packages
pnpm build

# Build individual packages
pnpm build:aztec
pnpm build:evm
pnpm build:relayer
```

## Configure

```bash
# Copy environment templates
cp .env.example .env
cp packages/evm/.env.example packages/evm/.env

# Edit .env files with your values
```

## Deploy

### Deploy EVM Contracts

```bash
cd packages/evm
forge script script/DeployMessageBridge.s.sol --rpc-url arbitrum_sepolia --broadcast --verify
```

### Deploy Aztec Contracts

```bash
pnpm --filter @wormhole-demo/aztec setup:deploy
```

## Run Relayer

```bash
# Start services (PXE, Wormhole Spy, Relayers)
docker compose up
```

## Send Message

```bash
# From Aztec to EVM
pnpm --filter @wormhole-demo/aztec send
```
