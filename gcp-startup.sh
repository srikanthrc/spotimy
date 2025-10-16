#!/bin/bash
# GCE Startup Script for Spotimy MCP Server
# This script runs on instance boot and handles container deployment

set -e

echo "=== Spotimy MCP Server Startup Script ==="
echo "Starting at: $(date)"

# Get project ID
PROJECT_ID=$(curl -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/project/project-id)
echo "Project ID: $PROJECT_ID"

# Pull environment variables from instance metadata
SPOTIFY_CLIENT_ID=$(curl -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/attributes/SPOTIFY_CLIENT_ID 2>/dev/null || echo "")
SPOTIFY_CLIENT_SECRET=$(curl -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/attributes/SPOTIFY_CLIENT_SECRET 2>/dev/null || echo "")
SPOTIFY_REDIRECT_URI=$(curl -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/attributes/SPOTIFY_REDIRECT_URI 2>/dev/null || echo "")
NGROK_AUTH_TOKEN=$(curl -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/attributes/NGROK_AUTH_TOKEN 2>/dev/null || echo "")
NGROK_DOMAIN=$(curl -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/attributes/NGROK_DOMAIN 2>/dev/null || echo "")

# Create data directory for persistent storage
mkdir -p /var/lib/spotimy/data
chmod 755 /var/lib/spotimy

# Configure Docker to authenticate with GCR using the instance service account
echo "Configuring Docker authentication for GCR..."
docker-credential-gcr configure-docker --registries=gcr.io 2>/dev/null || true

# Alternative: Use gcloud to configure docker (works on Container-Optimized OS)
/usr/bin/docker-credential-gcr configure-docker 2>/dev/null || true

# Pull and run the latest container
echo "Pulling latest container image..."
docker pull gcr.io/${PROJECT_ID}/spotimy-mcp:latest || {
    echo "Failed to pull image. Checking authentication..."
    # Try using metadata server token
    TOKEN=$(curl -H "Metadata-Flavor: Google" http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token | cut -d'"' -f4)
    echo $TOKEN | docker login -u oauth2accesstoken --password-stdin https://gcr.io
    docker pull gcr.io/${PROJECT_ID}/spotimy-mcp:latest
}

# Stop existing container if running
docker stop spotimy-mcp 2>/dev/null || true
docker rm spotimy-mcp 2>/dev/null || true

# Run the container
echo "Starting Spotimy MCP container..."
docker run -d \
  --name spotimy-mcp \
  --restart unless-stopped \
  -p 3001:3001 \
  -p 4040:4040 \
  -e HTTP_HOST=0.0.0.0 \
  -e HTTP_PORT=3001 \
  -e SPOTIFY_CLIENT_ID="${SPOTIFY_CLIENT_ID}" \
  -e SPOTIFY_CLIENT_SECRET="${SPOTIFY_CLIENT_SECRET}" \
  -e SPOTIFY_REDIRECT_URI="${SPOTIFY_REDIRECT_URI}" \
  -e NGROK_AUTH_TOKEN="${NGROK_AUTH_TOKEN}" \
  -e NGROK_DOMAIN="${NGROK_DOMAIN}" \
  -e TOKEN_STORE_PATH=/app/data \
  -v /var/lib/spotimy/data:/app/data \
  gcr.io/${PROJECT_ID}/spotimy-mcp:latest

echo "=== Container started successfully ==="
echo "Logs: docker logs -f spotimy-mcp"
echo "Status: docker ps | grep spotimy-mcp"
echo "Completed at: $(date)"

# Wait for container to be healthy
sleep 10
if docker ps | grep -q spotimy-mcp; then
  echo "✅ Container is running"
  docker logs spotimy-mcp --tail 20
else
  echo "❌ Container failed to start"
  docker logs spotimy-mcp
  exit 1
fi
