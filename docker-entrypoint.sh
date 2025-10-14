#!/bin/bash

# Function to handle graceful shutdown
cleanup() {
    echo "Shutting down services..."
    kill $NGROK_PID $SERVER_PID 2>/dev/null
    wait $NGROK_PID $SERVER_PID 2>/dev/null
    exit 0
}

# Set up signal handlers
trap cleanup SIGTERM SIGINT

# Set default values if not provided
HTTP_HOST=${HTTP_HOST:-127.0.0.1}
HTTP_PORT=${HTTP_PORT:-3001}
NGROK_AUTH_TOKEN=${NGROK_AUTH_TOKEN:-}
NGROK_DOMAIN=${NGROK_DOMAIN:-}

echo "Starting Spotify MCP Server with ngrok tunnel..."
echo "HTTP Host: $HTTP_HOST"
echo "HTTP Port: $HTTP_PORT"

# Ensure data directory exists and set up .env persistence
mkdir -p /app/data

# Ensure .env file is writable and properly set up
if [ -f "/app/.env" ]; then
    # Make sure the mounted .env file is writable
    chmod 644 /app/.env
    echo "Made .env file writable for token updates"
    
    # Also backup to persistent storage
    cp /app/.env /app/data/.env.backup
    echo "Backed up .env to persistent storage"
else
    # If no .env file exists, create one in persistent storage and link it
    if [ -f "/app/data/.env" ]; then
        ln -sf /app/data/.env /app/.env
        echo "Linked existing .env from persistent storage"
    else
        touch /app/data/.env
        ln -sf /app/data/.env /app/.env
        echo "Created new .env file in persistent storage"
    fi
fi

# Configure ngrok if auth token is provided
if [ -n "$NGROK_AUTH_TOKEN" ]; then
    echo "Configuring ngrok with auth token..."
    ngrok config add-authtoken "$NGROK_AUTH_TOKEN"
    echo "Ngrok configured with auth token"
fi

# Start the MCP HTTP server in the background
echo "Starting MCP HTTP server..."
bun build/http-server.js --host="$HTTP_HOST" --port="$HTTP_PORT" &
SERVER_PID=$!

# Wait a moment for the server to start
sleep 3

# Start ngrok tunnel if auth token is provided
if [ -n "$NGROK_AUTH_TOKEN" ]; then
    echo "Starting ngrok tunnel..."
    # Set web interface to bind to all interfaces
    export NGROK_WEB_ADDR="0.0.0.0:4040"

    if [ -n "$NGROK_DOMAIN" ]; then
        # Use custom domain if provided
        echo "Attempting to use custom domain: $NGROK_DOMAIN"
        ngrok http --url="$NGROK_DOMAIN" "$HTTP_PORT" --log stdout &
        NGROK_PID=$!
    else
        # Use random ngrok domain
        echo "Using random ngrok domain..."
        ngrok http "$HTTP_PORT" --log stdout &
        NGROK_PID=$!
    fi
else
    echo "Ngrok forwarding disabled (no NGROK_AUTH_TOKEN provided)"
    NGROK_PID=""
fi

# Wait a moment for ngrok to start
sleep 5

# Check if ngrok started successfully
if [ -n "$NGROK_PID" ] && ! kill -0 $NGROK_PID 2>/dev/null; then
    echo "⚠️  Ngrok failed to start (possibly due to session limit)"
    echo "💡 Check https://dashboard.ngrok.com/agents for active sessions"
    echo "💡 Or upgrade to a paid plan for multiple sessions"
    NGROK_PID=""
fi

# Show ngrok status if tunnel is running
if [ -n "$NGROK_PID" ]; then
    echo "Getting ngrok tunnel info..."
    curl -s http://localhost:4040/api/tunnels | bun -e "
const data = JSON.parse(await Bun.stdin.text());
if (data.tunnels && data.tunnels.length > 0) {
    const tunnel = data.tunnels[0];
    console.log('✅ Ngrok tunnel active:');
    console.log('   Public URL:', tunnel.public_url);
    console.log('   Local URL: ', tunnel.config.addr);
    console.log('   Proto:     ', tunnel.proto);
} else {
    console.log('⚠️  No active tunnels found');
}
" 2>/dev/null || echo "Could not fetch tunnel info (ngrok may still be starting)"
else
    echo "ℹ️  Ngrok forwarding disabled - server accessible locally only"
fi

echo ""
echo "🚀 Services started!"
echo "📡 MCP Server: http://$HTTP_HOST:$HTTP_PORT"
if [ -n "$NGROK_AUTH_TOKEN" ]; then
    echo "🌐 Ngrok Web Interface: http://localhost:4040 (container only)"
    echo "🌍 Public Access: Check tunnel info above"
else
    echo "🏠 Local Access Only: No ngrok auth token provided"
fi
echo "💾 Auth data stored in: /app/data"
echo ""

echo "Available endpoints:"
echo "  GET  /mcp                      - MCP SSE connection"
echo "  POST /mcp                      - MCP message endpoint"
echo "  GET  /health?sessionId=<id>    - Health check (session-specific)"
echo "  GET  /auth?sessionId=<id>      - Start Spotify OAuth for session"
echo "  GET  /callback                 - Spotify OAuth callback"
echo "  POST /revoke?sessionId=<id>    - Revoke session authorization"
echo ""

# Wait for both processes
wait $SERVER_PID $NGROK_PID