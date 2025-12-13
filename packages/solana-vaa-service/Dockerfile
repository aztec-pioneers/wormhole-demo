FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json ./

# Install dependencies
RUN pnpm install

# Copy source
COPY src ./src

# Expose port
EXPOSE 3001

CMD ["pnpm", "start"]
