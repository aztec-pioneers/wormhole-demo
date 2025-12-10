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
cd packages/evm && forge install && cd ../..
```

## Configure

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your values (PRIVATE_KEY is required)
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

## Deploy

### Deploy EVM Contracts

```bash
# Deploy and auto-update .env with EVM_BRIDGE_ADDRESS
pnpm deploy:evm:testnet
```

### Deploy Aztec Contracts

```bash
# Deploy and auto-update .env with AZTEC_BRIDGE_ADDRESS
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
