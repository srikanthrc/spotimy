# Use the official Bun image
FROM oven/bun:1 as base

# Set working directory
WORKDIR /app

# Install ngrok
RUN apt-get update && apt-get install -y curl gnupg && \
    curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc | gpg --dearmor -o /usr/share/keyrings/ngrok-archive-keyring.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/ngrok-archive-keyring.gpg] https://ngrok-agent.s3.amazonaws.com buster main" | tee /etc/apt/sources.list.d/ngrok.list && \
    apt-get update && apt-get install -y ngrok && \
    rm -rf /var/lib/apt/lists/*

# Copy package.json and bun.lockb for dependency installation
COPY package.json bun.lock* ./

# Install dependencies without running prepare scripts
RUN bun install --frozen-lockfile --ignore-scripts

# Copy source code
COPY . .

# Build the TypeScript code explicitly
RUN bunx tsc && chmod +x build/index.js

# Copy static assets to build directory
RUN mkdir -p build/static && cp -r src/static/* build/static/

# Create a directory for auth tokens (persistent storage)
RUN mkdir -p /app/data

# Create startup script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Expose the HTTP server port
EXPOSE 3001

# Use the startup script as entrypoint
ENTRYPOINT ["docker-entrypoint.sh"]