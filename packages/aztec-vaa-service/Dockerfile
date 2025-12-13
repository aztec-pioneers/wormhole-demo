# VAA Verification Service Dockerfile
# Runs the Aztec Wormhole VAA verification API service

FROM node:22-slim

# Install curl for healthcheck
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Copy root package files for workspace setup
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Copy all workspace package.json files (pnpm needs all packages present)
COPY packages/aztec/package.json packages/aztec/
COPY packages/aztec-vaa-service/package.json packages/aztec-vaa-service/

# Install dependencies (only for the packages we need)
# Use --ignore-scripts to skip root postinstall (git/forge commands not needed here)
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @aztec-wormhole-demo/aztec-vaa-service...

# Copy the aztec-contracts package source (our dependency)
COPY packages/aztec/ts/ packages/aztec/ts/

# Copy the aztec-vaa-service package source
COPY packages/aztec-vaa-service/src/ packages/aztec-vaa-service/src/

WORKDIR /app/packages/aztec-vaa-service

# Expose the API port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Run the VAA service
CMD ["pnpm", "start"]
