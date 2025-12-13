# EVM→Solana Relay - COMPLETE ✓

## Summary
The EVM→Solana cross-chain relay flow is now fully working. Messages sent from Arbitrum Sepolia are successfully received on Solana devnet.

## What Was Fixed

### 1. VAA Hash Computation (Go client)
**File:** `packages/relayer/internal/clients/solana.go`

Changed from double SHA256 to **keccak256**:
```go
// Wormhole uses keccak256 for VAA body hash (same as Ethereum)
hash := crypto.Keccak256Hash(body)
```

### 2. PostedVAA Parsing Offsets (Solana program)
**File:** `packages/solana/message_bridge/programs/message_bridge/src/lib.rs`

Fixed the Borsh-serialized MessageData layout:
- emitter_chain at offset **57** (was 16)
- emitter_address at offset **59** (was 18)
- sequence at offset **49** (was 50)
- payload at offset **95** (after 4-byte Vec length at 91)

All fields are **little-endian** (Borsh format).

## Verified Working
- Sent value **9999** from Arbitrum Sepolia → Solana devnet
- Transaction: `W8WpFATXTCWGBn6gDiMXeQsRfcPpc59tJcyp2GXtnJfWSudLxQ4D3xCTgQ9ZMAfF9zRkcrwAgAuhBhziWX2EeQ9`
- Solana current value: 9999 ✓

## Test Commands
```bash
# Send test message
pnpm send <value> --from arbitrum --to solana

# Check values on all chains
pnpm read:values

# Check logs
docker compose logs relayer-solana --tail 30
docker compose logs solana-vaa-service --tail 30

# Services
docker compose up -d wormhole-spy solana-vaa-service relayer-solana
```

## Environment
- Solana devnet RPC: https://api.devnet.solana.com
- Wormhole program: 3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5
- MessageBridge program: 3hvaMuhsJGzejYo3N4PgpkWfjJcDonWE7gYUzjWZEnrZ
- Payer: GVVyPsFLP3db9NxsKYTxxM9sQHD1PG3RkCYg5mYKbseP
