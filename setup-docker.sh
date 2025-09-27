#!/bin/bash

# Spotify MCP Server Docker Setup Script

set -e

echo "🎵 Spotify MCP Server Docker Setup"
echo "=================================="
echo ""

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check prerequisites
echo "📋 Checking prerequisites..."

if ! command_exists docker; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "   Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

if ! command_exists docker-compose; then
    if ! docker compose version >/dev/null 2>&1; then
        echo "❌ Docker Compose is not available. Please install Docker Compose."
        echo "   Visit: https://docs.docker.com/compose/install/"
        exit 1
    else
        echo "✅ Docker Compose (as docker compose) is available"
        DOCKER_COMPOSE_CMD="docker compose"
    fi
else
    echo "✅ Docker Compose is available"
    DOCKER_COMPOSE_CMD="docker-compose"
fi

echo "✅ Docker is available"
echo ""

# Check if .env file exists
if [ ! -f ".env" ]; then
    echo "⚙️  Setting up environment configuration..."
    
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo "✅ Created .env file from .env.example"
    else
        echo "❌ .env.example file not found. Creating basic .env file..."
        cat > .env << EOF
# Spotify API Configuration
SPOTIFY_CLIENT_ID=your_spotify_client_id_here
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret_here

# Server Configuration
HTTP_HOST=0.0.0.0
HTTP_PORT=3001

# Ngrok Configuration (optional)
# NGROK_AUTHTOKEN=your_ngrok_auth_token_here
# NGROK_DOMAIN=your-custom-domain.ngrok.dev
EOF
        echo "✅ Created basic .env file"
    fi
    
    echo ""
    echo "🔑 IMPORTANT: You need to configure your Spotify API credentials!"
    echo ""
    echo "1. Go to https://developer.spotify.com/dashboard"
    echo "2. Create a new app (or use existing)"
    echo "3. Copy your Client ID and Client Secret"
    echo "4. Edit the .env file and replace the placeholder values:"
    echo "   - SPOTIFY_CLIENT_ID=your_actual_client_id"
    echo "   - SPOTIFY_CLIENT_SECRET=your_actual_client_secret"
    echo ""
    echo "5. Add these redirect URIs in your Spotify app settings:"
    echo "   - http://localhost:3001/callback"
    echo "   - https://your-ngrok-url.ngrok.dev/callback (if using ngrok)"
    echo ""
    
    read -p "Press Enter when you've updated the .env file with your credentials..."
else
    echo "✅ .env file already exists"
fi

echo ""

# Validate .env file
echo "🔍 Validating configuration..."

if grep -q "your_spotify_client_id_here" .env || grep -q "your_spotify_client_secret_here" .env; then
    echo "⚠️  Warning: It looks like you haven't updated the Spotify credentials in .env"
    echo "   Make sure to replace the placeholder values with your actual Spotify API credentials"
    echo ""
fi

# Check if ngrok auth token is configured
if grep -q "# NGROK_AUTHTOKEN=" .env; then
    echo "💡 Tip: Consider adding your ngrok auth token for better tunnel stability"
    echo "   1. Sign up at https://ngrok.com"
    echo "   2. Get your auth token from https://dashboard.ngrok.com/get-started/your-authtoken"
    echo "   3. Uncomment and set NGROK_AUTHTOKEN in your .env file"
    echo ""
fi

# Build and start services
echo "🚀 Building and starting services..."
echo ""

$DOCKER_COMPOSE_CMD build
echo ""

echo "🎬 Starting containers..."
$DOCKER_COMPOSE_CMD up -d

echo ""
echo "⏳ Waiting for services to start..."
sleep 5

# Check if services are running
if $DOCKER_COMPOSE_CMD ps | grep -q "Up"; then
    echo "✅ Services are running!"
    echo ""
    
    # Get ngrok URL if available
    echo "🔗 Service URLs:"
    echo "   📡 MCP Server: http://localhost:3001"
    echo "   🏥 Health Check: http://localhost:3001/health"
    echo "   🔐 Start Auth: http://localhost:3001/auth"
    echo "   🌐 Ngrok Dashboard: http://localhost:4040"
    echo ""
    
    # Try to get ngrok public URL
    sleep 2
    if curl -s http://localhost:4040/api/tunnels | grep -q "public_url"; then
        NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | grep -o 'https://[^"]*ngrok[^"]*')
        if [ -n "$NGROK_URL" ]; then
            echo "🌍 Public ngrok URL: $NGROK_URL"
            echo "   🔐 Public Auth: $NGROK_URL/auth"
            echo "   🏥 Public Health: $NGROK_URL/health"
            echo ""
            echo "💡 Don't forget to add $NGROK_URL/callback to your Spotify app's redirect URIs!"
        fi
    fi
    
    echo ""
    echo "📋 Next Steps:"
    echo "1. Visit http://localhost:3001/health to check server status"
    echo "2. Visit http://localhost:3001/auth to start Spotify authentication"
    echo "3. Check logs with: $DOCKER_COMPOSE_CMD logs -f"
    echo "4. Stop services with: $DOCKER_COMPOSE_CMD down"
    echo ""
    echo "📖 For more information, see README.md (Docker section)"
    
else
    echo "❌ Services failed to start properly"
    echo ""
    echo "🔍 Checking logs..."
    $DOCKER_COMPOSE_CMD logs
    echo ""
    echo "💡 Try running: $DOCKER_COMPOSE_CMD down && $DOCKER_COMPOSE_CMD up -d"
fi

echo ""
echo "🎉 Setup complete!"