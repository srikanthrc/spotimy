#!/bin/bash

# Spotify MCP Server Docker Management Script

set -e

SCRIPT_NAME=$(basename "$0")
DOCKER_COMPOSE_CMD="docker-compose"

# Check if docker compose (newer) or docker-compose (older) is available
if ! command -v docker-compose >/dev/null 2>&1; then
    if docker compose version >/dev/null 2>&1; then
        DOCKER_COMPOSE_CMD="docker compose"
    else
        echo "❌ Docker Compose is not available"
        exit 1
    fi
fi

show_help() {
    echo "🎵 Spotify MCP Server Docker Management"
    echo "Usage: $SCRIPT_NAME [command]"
    echo ""
    echo "Commands:"
    echo "  start       Start the services"
    echo "  stop        Stop the services"
    echo "  restart     Restart the services"
    echo "  logs        Show logs (follow mode)"
    echo "  status      Show service status"
    echo "  build       Rebuild the images"
    echo "  clean       Stop and remove containers, networks, and volumes"
    echo "  health      Check health of the MCP server"
    echo "  auth        Open the Spotify auth URL"
    echo "  ngrok       Show ngrok tunnel information"
    echo "  shell       Open a shell in the container"
    echo "  help        Show this help message"
    echo ""
}

start_services() {
    echo "🚀 Starting Spotify MCP Server..."
    $DOCKER_COMPOSE_CMD up -d
    echo "✅ Services started!"
    echo ""
    show_urls
}

stop_services() {
    echo "🛑 Stopping services..."
    $DOCKER_COMPOSE_CMD down
    echo "✅ Services stopped!"
}

restart_services() {
    echo "🔄 Restarting services..."
    $DOCKER_COMPOSE_CMD restart
    echo "✅ Services restarted!"
    echo ""
    show_urls
}

show_logs() {
    echo "📋 Showing logs (Ctrl+C to exit)..."
    $DOCKER_COMPOSE_CMD logs -f
}

show_status() {
    echo "📊 Service Status:"
    $DOCKER_COMPOSE_CMD ps
    echo ""
    
    # Check if services are healthy
    if $DOCKER_COMPOSE_CMD ps | grep -q "Up"; then
        echo "✅ Services are running"
        show_urls
    else
        echo "❌ Services are not running"
        echo "💡 Try: $SCRIPT_NAME start"
    fi
}

build_images() {
    echo "🔨 Building images..."
    $DOCKER_COMPOSE_CMD build --no-cache
    echo "✅ Build complete!"
}

clean_all() {
    echo "🧹 Cleaning up..."
    echo "⚠️  This will remove containers, networks, and volumes!"
    read -p "Are you sure? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        $DOCKER_COMPOSE_CMD down -v --remove-orphans
        docker system prune -f
        echo "✅ Cleanup complete!"
    else
        echo "❌ Cleanup cancelled"
    fi
}

check_health() {
    echo "🏥 Checking server health..."
    
    if curl -s http://localhost:3001/health >/dev/null; then
        echo "✅ Server is responding"
        curl -s http://localhost:3001/health | jq . 2>/dev/null || curl -s http://localhost:3001/health
    else
        echo "❌ Server is not responding"
        echo "💡 Check if services are running: $SCRIPT_NAME status"
    fi
}

open_auth() {
    echo "🔐 Opening Spotify authentication..."
    
    if command -v open >/dev/null 2>&1; then
        # macOS
        open http://localhost:3001/auth
    elif command -v xdg-open >/dev/null 2>&1; then
        # Linux
        xdg-open http://localhost:3001/auth
    else
        echo "📱 Open this URL in your browser:"
        echo "   http://localhost:3001/auth"
    fi
}

show_ngrok_info() {
    echo "🌐 Ngrok tunnel information:"
    
    # Check if ngrok auth token is provided
    NGROK_AUTH_TOKEN=$(grep "^NGROK_AUTH_TOKEN=" .env 2>/dev/null | cut -d'=' -f2 | tr -d '"')
    
    if [ -z "$NGROK_AUTH_TOKEN" ]; then
        echo "ℹ️  Ngrok forwarding is disabled"
        echo "   Status: No NGROK_AUTH_TOKEN found in .env"
        echo "   💡 To enable: Set NGROK_AUTH_TOKEN=<your-token> in .env file"
        echo "   🏠 Server accessible locally at: http://localhost:3001"
        return
    fi
    
    # Try to get tunnel info from the container's ngrok API
    if $DOCKER_COMPOSE_CMD exec spotimy-mcp curl -s http://localhost:4040/api/tunnels >/dev/null 2>&1; then
        TUNNEL_INFO=$($DOCKER_COMPOSE_CMD exec spotimy-mcp curl -s http://localhost:4040/api/tunnels 2>/dev/null)
        
        if echo "$TUNNEL_INFO" | grep -q "public_url"; then
            # Extract tunnel information
            PUBLIC_URL=$(echo "$TUNNEL_INFO" | grep -o '"public_url":"[^"]*"' | cut -d'"' -f4)
            PROTO=$(echo "$TUNNEL_INFO" | grep -o '"proto":"[^"]*"' | cut -d'"' -f4)
            LOCAL_ADDR=$(echo "$TUNNEL_INFO" | grep -o '"addr":"[^"]*"' | cut -d'"' -f4)
            CONN_COUNT=$(echo "$TUNNEL_INFO" | grep -o '"gauge":[0-9]*' | head -1 | cut -d':' -f2)
            HTTP_COUNT=$(echo "$TUNNEL_INFO" | grep -o '"count":[0-9]*' | tail -1 | cut -d':' -f2)
            
            echo "✅ Tunnel Status: Active"
            echo "   🌍 Public URL: $PUBLIC_URL"
            echo "   🏠 Local URL:  $LOCAL_ADDR"
            echo "   🔒 Protocol:   $PROTO"
            echo "   📊 Stats: ${CONN_COUNT:-0} active connections, ${HTTP_COUNT:-0} total requests"
            echo ""
            echo "💡 Web Dashboard: Accessible inside container only"
            echo "   Access via: docker-compose exec spotimy-mcp curl http://localhost:4040"
        else
            echo "❌ No active tunnels found"
        fi
    else
        echo "❌ Cannot connect to ngrok API inside container"
        echo "💡 Make sure services are running: $SCRIPT_NAME status"
        echo "💡 Ngrok auth token provided but tunnel not accessible"
        echo "   Check container logs: $SCRIPT_NAME logs"
    fi
}

open_shell() {
    echo "🐚 Opening shell in container..."
    $DOCKER_COMPOSE_CMD exec spotimy-mcp /bin/bash
}

show_urls() {
    echo "🔗 Service URLs:"
    echo "   📡 MCP Server: http://localhost:3001"
    echo "   🏥 Health Check: http://localhost:3001/health"
    echo "   🔐 Start Auth: http://localhost:3001/auth"
    echo "   🌐 Ngrok Dashboard: http://localhost:4040"
    
    # Try to get ngrok public URL
    if curl -s http://localhost:4040/api/tunnels 2>/dev/null | grep -q "public_url"; then
        NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | grep -o 'https://[^"]*ngrok[^"]*' | head -1)
        if [ -n "$NGROK_URL" ]; then
            echo "   🌍 Public URL: $NGROK_URL"
        fi
    fi
    echo ""
}

# Main command handling
case "${1:-help}" in
    start)
        start_services
        ;;
    stop)
        stop_services
        ;;
    restart)
        restart_services
        ;;
    logs)
        show_logs
        ;;
    status)
        show_status
        ;;
    build)
        build_images
        ;;
    clean)
        clean_all
        ;;
    health)
        check_health
        ;;
    auth)
        open_auth
        ;;
    ngrok)
        show_ngrok_info
        ;;
    shell)
        open_shell
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        echo "❌ Unknown command: $1"
        echo ""
        show_help
        exit 1
        ;;
esac