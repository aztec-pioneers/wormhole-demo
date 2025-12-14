# Add Base Sepolia Support

## Base Sepolia Specs
- Wormhole Chain ID: **10004**
- EVM Chain ID: **84532**
- Wormhole Contract: `0x79A1027a6A159502049F10906D333EC57E95F083`
- RPC: `https://sepolia.base.org`

---

## Files to Modify

### 1. Constants

**`packages/aztec/ts/constants.ts`**
- Add `BASE_SEPOLIA_CHAIN_ID = 10004`

**`packages/solana/ts/src/constants.ts`**
- Add `CHAIN_ID_BASE_SEPOLIA = 10004`

---

### 2. EVM Utils (Parameterize for multiple chains)

**`scripts/utils/evm.ts`**
- Import `baseSepolia` from `viem/chains`
- Add `SUPPORTED_EVM_CHAINS` config object with arbitrum/base entries
- Update `createEvmClients(rpcUrl, privateKey, chainName?)` to accept optional chain parameter
- Default to "arbitrum" for backward compatibility

---

### 3. Deploy Script

**`scripts/deployEVM.ts`**
- Add CLI args: `--chain=arbitrum|base` and `--all`
- Create `CHAIN_CONFIGS` object with per-chain settings (RPC env var, bridge address env var, EVM chain ID for broadcast path)
- Refactor to `deployToChain(chainName)` function
- Save to `ARBITRUM_BRIDGE_ADDRESS` or `BASE_BRIDGE_ADDRESS` based on chain

**`package.json`** - Add scripts:
```
"deploy:arbitrum": "tsx scripts/deployEVM.ts --chain=arbitrum"
"deploy:base": "tsx scripts/deployEVM.ts --chain=base"
"deploy:evm": "tsx scripts/deployEVM.ts --all"
```

---

### 4. Register Emitters (4-chain matrix = 12 registrations)

**`scripts/registerEmitters.ts`**
- Import `BASE_SEPOLIA_CHAIN_ID`, `CHAIN_ID_BASE_SEPOLIA`
- Add env vars: `BASE_RPC_URL`, `BASE_BRIDGE_ADDRESS`, rename `EVM_BRIDGE_ADDRESS` -> `ARBITRUM_BRIDGE_ADDRESS`
- Refactor `configureEvmBridge()` to `configureEvmBridge(chainName: "arbitrum" | "base")`
- Each EVM chain registers emitters from: Aztec, Solana, and OTHER EVM chain
- Update `configureAztecBridge()` to register both Arbitrum AND Base emitters
- Update `configureSolanaBridge()` to register both Arbitrum AND Base emitters

---

### 5. Send Script

**`scripts/send.ts`**
- Update `VALID_CHAINS = ["arbitrum", "base", "solana", "aztec"]`
- Update `CHAIN_IDS` to include `base: CHAIN_ID_BASE_SEPOLIA`
- Add `sendFromBase()` function (clone of `sendFromArbitrum` using Base config)
- Add `case "base":` to main switch

---

### 6. Read Scripts

**`scripts/readValues.ts`**
- Add `readBaseBridge()` function
- Add to `Promise.all([...])`

**`scripts/readEmitters.ts`**
- Add `checkBaseBridge()` function
- Update other check functions to verify Base emitter registration
- Update summary for 4-chain status

---

### 7. Relayer Go Code

**`packages/relayer/cmd/base.go`** (NEW FILE)
- Clone from `evm.go`
- Change `BaseDestinationChainID = 10004`
- Change `DefaultBaseSourceChains = []int{56, 1, 10003}` (Aztec, Solana, Arbitrum)
- Change flag names to `--base-rpc-url`, `--base-target-contract`
- Default RPC to `https://sepolia.base.org`

**`packages/relayer/cmd/evm.go`**
- Update `DefaultEVMSourceChains = []int{56, 1, 10004}` (add Base as source)

**`packages/relayer/cmd/aztec.go`**
- Update `DefaultAztecSourceChains = []int{10003, 1, 10004}` (add Base)

**`packages/relayer/cmd/solana.go`**
- Update `DefaultSolanaSourceChains = []int{10003, 56, 10004}` (add Base)

---

### 8. Docker Compose

**`docker-compose.yml`**
- Rename `relayer-evm` to `relayer-arbitrum` (optional, for clarity)
- Update `relayer-arbitrum` chain-ids to `56,1,10004`
- Add `relayer-base` service:
  ```yaml
  relayer-base:
    command:
      - base
      - --private-key=${EVM_PRIVATE_KEY}
      - --base-target-contract=${BASE_BRIDGE_ADDRESS}
      - --chain-ids=56,1,10003
    environment:
      - WORMHOLE_RELAYER_BASE_RPC_URL=${BASE_RPC_URL}
  ```
- Update `relayer-aztec` chain-ids to `10003,1,10004`
- Update `relayer-solana` chain-ids to `10003,56,10004`

---

### 9. Environment

**`.env`**
- Rename `EVM_BRIDGE_ADDRESS` -> `ARBITRUM_BRIDGE_ADDRESS`
- Add Base section:
  ```
  BASE_RPC_URL=https://sepolia.base.org
  BASE_WORMHOLE_ADDRESS=0x79A1027a6A159502049F10906D333EC57E95F083
  BASE_CHAIN_ID=10004
  BASE_WORMHOLE_CONSISTENCY=200
  BASE_BRIDGE_ADDRESS=
  ```

**`.env.example`** - Same updates

---

## Implementation Order

1. **Constants** - Add chain ID constants (non-breaking)
2. **EVM Utils** - Parameterize `createEvmClients()` with default for backward compat
3. **Deploy Script** - Refactor with chain parameter, test with `--chain=arbitrum` first
4. **Environment** - Update .env with Base config and rename EVM_BRIDGE_ADDRESS
5. **Read Scripts** - Add Base reading (safe, additive)
6. **Send Script** - Add Base support
7. **Register Emitters** - Refactor for 4-chain matrix
8. **Relayer Go** - Add base.go, update source chains in other commands
9. **Docker Compose** - Add relayer-base service

---

## Testing Checklist

After implementation, test all 12 paths:
```
arbitrum -> aztec, solana, base
base -> aztec, solana, arbitrum
aztec -> arbitrum, solana, base
solana -> arbitrum, aztec, base
```
