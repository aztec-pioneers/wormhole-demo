# Aztec Wormhole Demo
Simple showcase of Aztec<>EVM cross chain communication

* Set a u128 value on Arbitrum Sepolia from Aztec Devnet with private or public broadcasting
* Set a u128 value on Aztec Devnet from Arbitrum Sepolia

## Prerequisites

- Node.js (v22+)
- pnpm (v9+)
- Aztec (v3.0.0-devnet.5)
- Foundry (latest)
- Docker / Docker Compose

## Usage
Note: relaying on wormhole devnet routinely takes up to 20 minutes. This is a limitation of the testnet environment - the guardian service is configured on a slow cadence. In practice, this is not a concern on mainnet.

### 1. Installation
Install the repo and all dependencies
```bash
# Clone the repo
git clone https://github.com/aztec-pioneers/wormhole-demo && cd wormhole-demo

# Install dependencies
# Notice: will automatically install submodules and forge dependencies
pnpm i
```

### 2. Environment setup
Create .env and add all needed environment variables
```bash
# copy the .env
cp .env.example .env

# Update the following in .env

## Must be a private key funded with arbitrum sepolia eth for deployment and relaying
EVM_PRIVATE_KEY=0x...
ETHERSCAN_API_KEY=...
## Optional: include your etherscan api key to verify the evm emitter source
```

### 3. Compilation
Compile smart contracts for all chains
```bash
pnpm build
```

### 4. Setup an Aztec Relayer account
Create a new aztec relayer account that will use the sponsored FPC. The private key and salt will automatically be updated in the .env at the end of this script.

You can set the `AZTEC_RELAYER_PRIVATE_KEY` and `AZTEC_RELAYER_SALT` manually and skip this step if you prefer.
```bash
pnpm create-relayer-account
```

### 5. Deploy the bridge contracts
The message bridges on each chain act both as emitters and receivers for wormhole messages, so we deploy one contract per chain. The bridge contract addresses will automatically be updated at the end of this script.
```bash
pnpm deploy
```

### 6. Register emitters for each chain
Each receiver contract must register an emitter contract that is allowed to send messages to it for a given chain.
NOTE: there is a bug with the aztec wormhole implementation and the core wormhole contract (not the bridge we deploy in step 5) will be set as the emitter. This should be fixed in future iterations.
```bash
# register emitters on each chain
pnpm register-emitters

# check the registration happened successfully
pnpm read:emitters
```

### 7. Start the relayer
All relayer services are bundled into a docker compose that can be started up with one command. You can send values without the relayer being live, but messages will not land if the relayer is not listening when the VAA is captured from the wormhole spy service stream.
```bash
# IN A SEPARATE TERMINAL
pnpm relayer
```

### 8. Update the value on an EVM chain using the Aztec bridge
You can privately or publicly send a message through wormhole from Aztec to a destination chain. In this demo, the private/ public broadcasting doesn't really matter, but the pattern is nonetheless demonstrated.
```bash
# Set the value on arbitrum sepolia to 200 {defaults to private call}
pnpm send:aztec 200

# Privately set the value on arbitrum sepolia to 10293
pnpm send:aztec 10293 --private

# Publicly set the value on arbitrum sepolia to 7777777
pnpm send:aztec 7777777 --public
```

### 9. Update the value on Aztec using the EVM chain bridge
```bash
pnpm send:evm 69420
```

### 10. Check the values on each chain
Once the cross-chain messages from each side have been relayed (watch the relayer terminal logs), you can check that the intended action has been relayed across the chain.
```bash
pnpm read:values
```

## How it works
TODO

### Aztec
#### Encoding

#### Decoding

#### Replay Protection

#### Relaying

### EVM
#### Encoding

#### Decoding

#### Replay Protection

#### Relaying