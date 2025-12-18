# Cloudflare Containers Dockerfile
# Simplified version without ngrok (handled by Workers routing)

FROM oven/bun:1 AS base

WORKDIR /app

# Install sqlite3 (no ngrok needed)
RUN apt-get update && apt-get install -y sqlite3 && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile --ignore-scripts

# Copy source code
COPY . .

# Build TypeScript
RUN bunx tsc && chmod +x build/index.js

# Copy static assets
RUN mkdir -p build/static && cp -r src/static/* build/static/

# Create data directory
RUN mkdir -p /app/data

EXPOSE 3001

# Run the HTTP server directly - bind to 0.0.0.0 for container networking
CMD ["bun", "build/http-server.js", "--host=0.0.0.0", "--port=3001"]

