# Solana Integration Plan

This document outlines the full integration plan for adding Solana support to the Aztec-EVM-Wormhole cross-chain messaging demo.

## Current Architecture

```
┌─────────────┐    Wormhole    ┌─────────────┐
│   Aztec     │◄──────────────►│    EVM      │
│ MessageBridge│   (Guardians)  │ MessageBridge│
└─────────────┘                └─────────────┘
       │                              │
       └──────────┬───────────────────┘
                  │
            ┌─────▼─────┐
            │  Relayer  │
            │   (Go)    │
            └───────────┘
```

## Target Architecture

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   Aztec     │◄───────►│   Solana    │◄───────►│    EVM      │
│ MessageBridge│         │ MessageBridge│         │ MessageBridge│
└─────────────┘         └─────────────┘         └─────────────┘
       │      Wormhole        │      Wormhole         │
       │     Guardians        │     Guardians         │
       └──────────────────────┼───────────────────────┘
                              │
                        ┌─────▼─────┐
                        │  Relayer  │
                        │   (Go)    │
                        └───────────┘
```

---

## Phase 1: Environment Setup

- [x] **1.1** Install Solana CLI tools
  - `solana-cli` (v1.18+)
  - `anchor` CLI (v0.30+)
  - Verify with `solana --version` and `anchor --version`

- [x] **1.2** Configure Solana testnet (Wormhole Core Bridge is on testnet)
  - Set cluster: `solana config set --url testnet`
  - Create keypair: `solana-keygen new`
  - Fund wallet via faucet: https://faucet.solana.com

- [x] **1.3** Add Solana dependencies to workspace
  - Update `pnpm-workspace.yaml` to include `packages/solana/ts`
  - Add `@solana/web3.js` and `@coral-xyz/anchor` to root deps
  - Add `@aztec-wormhole-demo/solana-sdk@workspace:*` to root for script imports

---

## Phase 2: Solana Program (Anchor)

### 2.1 Project Scaffolding

- [x] **2.1.1** Initialize Anchor project
  ```bash
  cd packages/solana
  anchor init message_bridge --no-git
  ```

- [x] **2.1.2** Configure `Anchor.toml` for devnet
  - Set cluster to devnet
  - Configure program ID
  - Add Wormhole program references

- [x] **2.1.3** Add Wormhole dependencies to `Cargo.toml`
  ```toml
  [dependencies]
  anchor-lang = "0.30.1"
  wormhole-anchor-sdk = "0.30.1-alpha.3"
  wormhole-io = "0.1"
  ```

### 2.2 Program Implementation

- [x] **2.2.1** Define state accounts
  - Config, ForeignEmitter, CurrentValue, ReceivedMessage, WormholeEmitter, Counter

- [x] **2.2.2** Implement `initialize` instruction
  - Create config PDA
  - Store Wormhole addresses
  - Set owner

- [x] **2.2.3** Implement `register_emitter` instruction
  - Owner-only guard
  - Store foreign emitter address for chain ID
  - Match EVM/Aztec pattern

- [x] **2.2.4** Implement `send_value` instruction (Solana -> other chains)
  - Encode payload: `destination_chain_id (2 bytes) + value (16 bytes)`
  - Call Wormhole `post_message` via CPI
  - Handle Wormhole fee transfer
  - Emit event

- [x] **2.2.5** Implement `receive_value` instruction (other chains -> Solana)
  - Accept posted VAA account
  - Verify VAA is from registered emitter
  - Parse payload: `tx_id (32 bytes) + destination_chain_id (2 bytes) + value (16 bytes)`
  - Check destination chain matches Solana
  - Store value, mark as processed (nullifier)
  - Emit event

- [x] **2.2.6** Implement view functions
  - `get_config`
  - `get_registered_emitter`
  - `get_current_value`
  - `is_message_processed`

### 2.3 Testing

- [x] **2.3.1** Write counter test in TypeScript (basic contract access)
  - Test initialization
  - Test increment

- [ ] **2.3.2** Local validator testing (optional - using devnet instead)
  - Run `anchor test` with local validator

---

## Phase 3: TypeScript SDK / Client

- [x] **3.1** Create `packages/solana/ts/` directory structure
  ```
  ts/
  ├── src/
  │   ├── index.ts
  │   ├── client.ts       # MessageBridgeClient class
  │   ├── constants.ts    # Chain IDs, seeds, discriminators
  │   └── types.ts        # TypeScript interfaces
  ├── package.json
  └── tsconfig.json
  ```

- [x] **3.2** Generate IDL types from Anchor
  - IDL generated at `message_bridge/target/idl/message_bridge.json`
  - Manual parsing used (compatible with 0.30.1 IDL format)

- [x] **3.3** Implement client functions
  - `initialize()` - Initialize the message bridge
  - `registerEmitter(chainId, emitterAddress)` - Register foreign chain
  - `sendValue(destinationChainId, value)` - Send to other chains
  - `receiveValue(postedVaa, vaaHash, emitterChain, sequence)` - Receive from other chains
  - `getConfig()` - Read config
  - `getCurrentValue()` - Read current value
  - `getForeignEmitter(chainId)` - Read registered emitter
  - `isMessageReceived(chain, sequence)` - Check replay protection
  - `initializeCounter()` / `incrementCounter()` / `getCounter()` - Testing helpers
  - Static helpers: `evmAddressToWormhole()`, `aztecAddressToWormhole()`

---

## Phase 4: Relayer Updates

### 4.1 Solana VAA Fetching

- [ ] **4.1.1** Add Solana RPC client to relayer
  - Add `github.com/gagliardetto/solana-go` dependency
  - Configure Solana RPC endpoint in `.env`

- [ ] **4.1.2** Implement Solana transaction monitoring
  - Subscribe to Wormhole message events from Solana
  - Parse emitted messages for bridge transactions

### 4.2 Solana VAA Submission

- [ ] **4.2.1** Implement VAA posting to Solana
  - Post VAA to Wormhole Core Bridge
  - Wait for VAA verification
  - Call `receive_value` on MessageBridge

- [ ] **4.2.2** Update relayer routing logic
  - Add Solana chain ID (1) to routing table
  - Route messages: Aztec -> Solana, EVM -> Solana, Solana -> Aztec, Solana -> EVM

### 4.3 Configuration

- [ ] **4.3.1** Add Solana config to `.env.example`
  ```
  SOLANA_RPC_URL=https://api.devnet.solana.com
  SOLANA_PRIVATE_KEY=<base58>
  SOLANA_MESSAGE_BRIDGE_PROGRAM_ID=<pubkey>
  ```

- [ ] **4.3.2** Update `docker-compose.yml` if needed

---

## Phase 5: Deployment Scripts

- [x] **5.1** Create `scripts/deploySolana.ts`
  - Checks for existing deployment and closes to recover rent
  - Generates new program keypair
  - Updates lib.rs and Anchor.toml with new program ID
  - Builds and deploys to devnet
  - Initializes bridge (Config, CurrentValue, WormholeEmitter PDAs)
  - Initializes counter for testing
  - Saves program ID to `.env`
  - Prints emitter address for registration
  - **Deployed: `3fUukpbbRBydKXKYwpXojTtQSWxFbQ5EB7DmoVsZqJ2c`**
  - **Note**: Uses `wormhole-anchor-sdk` with `solana-devnet` feature (Wormhole: `3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5`)

- [x] **5.2** Create `scripts/testSolanaCounter.ts`
  - Test basic contract access on devnet
  - Verified counter increment works

- [x] **5.3** Unified `scripts/send.ts`
  - Single script: `pnpm send <value> --from <source> --to <destination>`
  - Supports all chains: arbitrum | solana | aztec
  - u128 range validation, chain validation, source != destination
  - Replaces old sendValueEVM.ts and sendValueAztec.ts

- [x] **5.4** Update `scripts/registerEmitters.ts`
  - Register Solana emitter on EVM
  - Register Solana emitter on Aztec
  - Register EVM emitter on Solana
  - Register Aztec emitter on Solana
  - Created `scripts/utils/solana.ts` with `loadKeypair()`, `createSolanaClient()`, etc.

- [x] **5.5** Update `scripts/readValues.ts`
  - Add Solana value reading
  - Display tri-chain state

- [x] **5.6** Update `scripts/readEmitters.ts`
  - Show Solana registered emitters
  - Show Solana emitter on other chains
  - Checks all 6 emitter registrations across 3 chains

- [x] **5.7** Update root `package.json` scripts
  ```json
  {
    "build:solana": "cd packages/solana/message_bridge && anchor build",
    "deploy:solana": "tsx scripts/deploySolana.ts",
    "test:solana": "tsx scripts/testSolanaCounter.ts",
    "deploy:all": "pnpm run deploy:evm && pnpm run deploy:aztec && pnpm run deploy:solana"
  }
  ```

---

## Phase 6: Integration Testing

- [ ] **6.1** EVM -> Solana flow
  - Send value from EVM MessageBridge
  - Wait for VAA
  - Submit to Solana MessageBridge
  - Verify value received

- [ ] **6.2** Solana -> EVM flow
  - Send value from Solana MessageBridge
  - Wait for VAA
  - Submit to EVM MessageBridge
  - Verify value received

- [ ] **6.3** Aztec -> Solana flow
  - Send value from Aztec MessageBridge
  - Wait for VAA (via Aztec Guardian)
  - Submit to Solana MessageBridge
  - Verify value received

- [ ] **6.4** Solana -> Aztec flow
  - Send value from Solana MessageBridge
  - Wait for VAA
  - Submit to Aztec MessageBridge
  - Verify value received

- [ ] **6.5** Full tri-chain round trip
  - Aztec -> EVM -> Solana -> Aztec

---

## Phase 7: Documentation

- [ ] **7.1** Update root `README.md`
  - Add Solana setup instructions
  - Update architecture diagram
  - Add Solana-specific commands

- [ ] **7.2** Create `packages/solana/README.md`
  - Program overview
  - Build instructions
  - Deployment guide
  - Testing guide

- [ ] **7.3** Update `.env.example`
  - Add all Solana environment variables

---

## Chain IDs Reference

| Chain | Wormhole Chain ID | Native Chain ID |
|-------|-------------------|-----------------|
| Solana (Devnet) | 1 | N/A |
| Ethereum | 2 | 1 |
| Arbitrum Sepolia | 10003 | 421614 |
| Aztec | 56 | N/A |

---

## Key Dependencies

### Rust/Anchor
- `anchor-lang` = "0.30"
- `wormhole-anchor-sdk` = "0.1"
- `wormhole-core-bridge-solana` = "0.1"

### TypeScript
- `@solana/web3.js` = "^1.95"
- `@coral-xyz/anchor` = "^0.30"
- `@wormhole-foundation/sdk-solana` = "^1.0"

### Go (Relayer)
- `github.com/gagliardetto/solana-go`
- `github.com/wormhole-foundation/wormhole/sdk/vaa`

---

## Wormhole Contract Addresses (Testnet)

| Contract | Address |
|----------|---------|
| Core Bridge | `3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5` |
| Token Bridge | `DZnkkTmCiFWfYTfT41X3Rd1kDgozqzxWaHqsw6W4x2oe` |
| Executor | `execXUrAsMnqMmTHj5m7N1YQgsDz3cwGLYCYyuDRciV` |

Source: [Wormhole Contract Addresses](https://wormhole.com/docs/products/reference/contract-addresses/)

---

## Open Questions (To Resolve)

- [x] Which Solana cluster to use? **Testnet** (Wormhole Core Bridge deployed there)
- [ ] Should Solana program support both public and private messaging like Aztec?
- [ ] Relayer: single binary with tri-chain support or separate Solana relayer?
- [ ] Fee handling: who pays Solana tx fees for relayed messages?

---

## Estimated Complexity

| Phase | Complexity | Notes |
|-------|------------|-------|
| Phase 1 | Low | Environment setup |
| Phase 2 | High | Core program implementation |
| Phase 3 | Medium | TS client library |
| Phase 4 | High | Relayer integration |
| Phase 5 | Medium | Scripts and tooling |
| Phase 6 | Medium | Integration testing |
| Phase 7 | Low | Documentation |

---

## Getting Started

After review and approval, begin with:

1. **Phase 1** - Set up Solana dev environment
2. **Phase 2.1** - Scaffold Anchor project
3. **Phase 2.2** - Implement program (iteratively)

Start by running:
```bash
# Install Solana CLI
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"

# Install Anchor
cargo install --git https://github.com/coral-xyz/anchor anchor-cli

# Verify
solana --version
anchor --version

# Configure for testnet (where Wormhole is deployed)
solana config set --url testnet

# Fund via faucet: https://faucet.solana.com
```
