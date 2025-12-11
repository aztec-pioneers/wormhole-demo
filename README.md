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

# Edit .env with your values (EVM_PRIVATE_KEY is required), the rest of existing .env should be fine
```

## Build

```bash
# Build aztec contracts
pnpm build:aztec
```

## Aztec Account Setup

```bash
# Generate and register a new Aztec relayer account
# (Saves AZTEC_RELAYER_PRIVATE_KEY and AZTEC_RELAYER_SALT to .env)
pnpm --filter @aztec-wormhole-demo/aztec-contracts setup:account
```

## Deploy

### Deploy EVM Contracts

```bash
# Deploy and auto-update .env with EVM_BRIDGE_ADDRESS
pnpm deploy:evm
```

### Deploy Aztec Contracts

```bash
# Deploy and auto-update .env with AZTEC_BRIDGE_ADDRESS
pnpm deploy:aztec
```

### Configure Bridges

After both contracts are deployed, configure them to trust each other:

```bash
# Register emitters on both EVM and Aztec bridges
pnpm configure
```

This will:
- Register the Aztec bridge as a trusted emitter on the EVM bridge
- Register the EVM bridge as a trusted emitter on the Aztec bridge

### Verify Configuration

```bash
# Check that emitters are registered correctly on both chains
pnpm check:emitters
```

## Run Relayer Services

```bash
# Start services (Wormhole Spy, VAA Service, Relayers)
docker compose up
```

## Send Messages

### Aztec to EVM

```bash
# Send with specific value
pnpm send-to-evm 100

# Send using public context
pnpm send-to-evm --public

# Send using private context (explicit)
pnpm send-to-evm --private
```

### EVM to Aztec

```bash
# Send value from EVM to Aztec
pnpm send-to-aztec

# Send with specific value
pnpm send-to-aztec 42
```

## Read Values

```bash
# Read current values on both EVM and Aztec bridges
pnpm read
```
