# Solana Anchor IDL Build Issue

## Problem

When building the Solana program with `anchor build`, the IDL generation fails with:

```
error[E0599]: no method named `source_file` found for struct `proc_macro2::Span` in the current scope
   --> anchor-syn-0.30.1/src/idl/defined.rs:499:66
    |
499 |                 let source_path = proc_macro2::Span::call_site().source_file().path();
    |                                                                  ^^^^^^^^^^^ method not found in `proc_macro2::Span`
```

## Root Cause

This is caused by a breaking change in the Rust compiler's `proc_macro` API:

1. **Rust nightly-2025-04-16** removed `proc_macro::SourceFile` and `Span::source_file()` ([PR #139671](https://github.com/rust-lang/rust/pull/139671))
2. **proc-macro2 v1.0.95+** updated to use the new API (`local_file()` instead of `source_file()`)
3. **anchor-syn 0.30.1** still uses the old `source_file()` API

The fix is in `anchor-syn` 0.31.1+, which was updated to use `local_file()` ([PR #3663](https://github.com/solana-foundation/anchor/pull/3663)).

## Why We Can't Just Upgrade

This project depends on `wormhole-anchor-sdk` 0.30.1-alpha.3, which requires `anchor-lang` 0.30.1:

```toml
# packages/solana/message_bridge/programs/message_bridge/Cargo.toml
anchor-lang = "0.30.1"
wormhole-anchor-sdk = { version = "0.30.1-alpha.3", ... }
```

Since `anchor-lang` 0.30.1 pulls `anchor-syn` 0.30.1 for IDL generation, we're stuck with the old code that uses `source_file()`.

## Attempted Solutions (All Failed)

| Approach | Result |
|----------|--------|
| Pin proc-macro2 to 1.0.94 | Fails - `proc_macro::SourceFile` removed from rustc |
| Use older nightly (pre-April 2025) | Fails - SourceFile was already removed |
| Use pre-built anchor 0.31.1 binary | Fails - IDL build still compiles anchor-syn from crates.io |
| Patch anchor-syn via Cargo.toml | Fails - version mismatch prevents patching |
| Set RUSTFLAGS for procmacro2_semver_exempt | Fails - IDL subprocess doesn't inherit env vars |

## Solution

Skip IDL generation since this project's TypeScript SDK doesn't use it:

```json
"build:solana": "cd packages/solana/message_bridge && anchor build --no-idl"
```

The SDK uses hand-rolled `@solana/web3.js` instructions instead of Anchor's IDL-based client.

## When Will This Be Fixed?

IDL generation will work when either:

1. **wormhole-anchor-sdk releases a 0.31.x version** that depends on `anchor-lang` 0.31.1+
2. **You upgrade anchor-lang to 0.31.1+** and accept incompatibility with wormhole-anchor-sdk

## References

- [proc_macro::SourceFile removal (Rust PR #139671)](https://github.com/rust-lang/rust/pull/139671)
- [anchor-syn fix (Anchor PR #3663)](https://github.com/solana-foundation/anchor/pull/3663)
- [GitHub Issue #3661](https://github.com/solana-foundation/anchor/issues/3661)
- [wormhole-anchor-sdk on crates.io](https://crates.io/crates/wormhole-anchor-sdk)
