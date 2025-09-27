# Spotify MCP Server

> **Note**: This project is based on the original [ArtistLens](https://github.com/superseoworld/artistlens) by Thomas Wawra, but has been significantly modified and is now maintained as a separate project focused on enhanced HTTP transport, OAuth integration, and modern logging capabilities.

A powerful Model Context Protocol (MCP) server that provides access to the Spotify Web API. This server enables seamless interaction with Spotify's music catalog, including searching for tracks, albums, and artists, as well as accessing artist-specific information like top tracks and related artists.

**Current Version:** 0.4.12

<a href="https://glama.ai/mcp/servers/mmrvuig6tp"><img width="380" height="200" src="https://glama.ai/mcp/servers/mmrvuig6tp/badge" alt="ArtistLens MCP server" /></a>

## Quick Start

### 🐳 Docker Setup (Recommended)

The easiest way to get started is with Docker, which includes both the MCP server and ngrok tunneling:

```bash
# Clone and setup
git clone <repository-url>
cd spotimy

# Run the setup script
./setup-docker.sh

# Or manually:
cp .env.example .env
# Edit .env with your Spotify credentials
docker-compose up -d
```

**Management commands:**
```bash
./manage-docker.sh start     # Start services
./manage-docker.sh status    # Check status
./manage-docker.sh logs      # View logs
./manage-docker.sh health    # Check server health
./manage-docker.sh auth      # Open Spotify auth
./manage-docker.sh stop      # Stop services
```

## � Configuration

### Required Environment Variables

Create a `.env` file with these required variables:

```env
# Get these from https://developer.spotify.com/dashboard
SPOTIFY_CLIENT_ID=your_client_id_here
SPOTIFY_CLIENT_SECRET=your_client_secret_here

# Server configuration  
HTTP_HOST=0.0.0.0
HTTP_PORT=3001

# Ngrok configuration (recommended)
NGROK_AUTHTOKEN=your_ngrok_auth_token
NGROK_DOMAIN=your-custom-domain.ngrok.dev  # Optional: requires paid ngrok plan
```

### Getting Credentials

**Spotify API:**
1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app and copy Client ID & Secret
3. Add redirect URI: `http://localhost:3001/callback`

**Ngrok (Optional):**
1. Sign up at [ngrok.com](https://ngrok.com) 
2. Get your auth token from [dashboard](https://dashboard.ngrok.com/get-started/your-authtoken)
3. Add to `.env` for stable tunnels and custom domains

## 📊 Monitoring & Management

### Docker Commands
```bash
# Essential commands
docker-compose up -d          # Start services
docker-compose logs -f        # View logs  
docker-compose down           # Stop services
docker-compose restart        # Restart services

# Management script shortcuts
./manage-docker.sh status     # Check all services
./manage-docker.sh health     # Server health check
./manage-docker.sh ngrok      # Tunnel information
./manage-docker.sh shell      # Access container
```

### Service URLs
- **Local Health**: http://localhost:3001/health
- **Start Auth**: http://localhost:3001/auth  
- **Ngrok Dashboard**: http://localhost:4040
- **Public URL**: Shown in logs/dashboard

### 💻 Local Development Setup

For development and testing:

```bash
# Clone the repository
git clone <repository-url>
cd spotimy

# Install dependencies
bun install

# Run in development mode
bun run dev        # stdio transport
bun run dev:http   # HTTP transport with OAuth
```

### Original ArtistLens Installation

For the original ArtistLens package, see the [official repository](https://github.com/superseoworld/artistlens):

```bash
npx -y @thomaswawra/artistlens
```

## Configuration

Add to your MCP settings file (e.g., `claude_desktop_config.json` or `cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "spotify": {
      "command": "bun",
      "args": ["run", "dev"],
      "cwd": "/path/to/spotimy",
      "env": {
        "SPOTIFY_CLIENT_ID": "your_client_id",
        "SPOTIFY_CLIENT_SECRET": "your_client_secret"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

You'll need to provide your Spotify API credentials:
1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new application
3. Get your Client ID and Client Secret
4. Add them to the configuration as shown above

## Features

- Search for tracks, albums, artists, and playlists
- Get artist information including top tracks and related artists
- Get album information and tracks
- Access new releases and recommendations
- Get audiobook information with market-specific content and chapters
- Note: Audiobook endpoints may require additional authentication or market-specific access
- Get and modify playlist information (name, description, public/private status)
- Access playlist tracks and items with pagination support
- Support for both Spotify IDs and URIs
- Automatic token management with client credentials flow
- Comprehensive test suite for all functionality
- Well-organized code with separation of concerns

## Available Tools

- `get_access_token`: Get a valid Spotify access token
- `search`: Search for tracks, albums, artists, or playlists
- `get_artist`: Get artist information
- `get_artist_top_tracks`: Get an artist's top tracks
- `get_artist_related_artists`: Get artists similar to a given artist
- `get_artist_albums`: Get an artist's albums
- `get_album`: Get album information
- `get_album_tracks`: Get an album's tracks
- `get_track`: Get track information
- `get_available_genres`: Get a list of available genres for recommendations
- `get_new_releases`: Get new album releases
- `get_recommendations`: Get track recommendations based on seed tracks, artists, or genres
- `get_audiobook`: Get audiobook information with optional market parameter
- `get_multiple_audiobooks`: Get information for multiple audiobooks (max 50)
- `get_audiobook_chapters`: Get chapters of an audiobook with pagination support (1-50 chapters per request)
- `get_playlist`: Get a playlist owned by a Spotify user
- `get_playlist_tracks`: Get full details of the tracks of a playlist (1-100 tracks per request)
- `get_playlist_items`: Get full details of the items of a playlist (1-100 items per request)
- `modify_playlist`: Change playlist details (name, description, public/private state, collaborative status)
- `add_tracks_to_playlist`: Add one or more tracks to a playlist with optional position
- `remove_tracks_from_playlist`: Remove one or more tracks from a playlist with optional positions and snapshot ID
- `get_current_user_playlists`: Get a list of the playlists owned or followed by the current Spotify user (1-50 playlists per request)
- `get_featured_playlists`: Get a list of Spotify featured playlists with optional locale and pagination support
- `get_category_playlists`: Get a list of Spotify playlists tagged with a particular category

## Key Differences from Original ArtistLens

This fork includes several enhancements:

- ✅ **Enhanced HTTP Transport** with integrated OAuth flow
- ✅ **Modern Logging System** using Pino with structured JSON output
- ✅ **Environment-aware Configuration** (development vs production modes)
- ✅ **Real-time Token Validation** through health endpoints
- ✅ **Comprehensive Error Handling** with contextual logging
- ✅ **Single-server OAuth Integration** eliminating need for separate callback servers

## Development

This project is a research fork based on the original ArtistLens. The original project is available at [https://github.com/superseoworld/artistlens](https://github.com/superseoworld/artistlens).

### Project Structure

The codebase is organized into the following directories:
- `src/handlers/`: Contains handler classes for different Spotify API endpoints
- `src/types/`: TypeScript interfaces for request and response objects
- `src/utils/`: Utility functions and classes for API communication (including `logger.ts`)
- `src/__tests__/`: Jest test files for all functionality

### Logging System

This Spotify MCP server uses [Pino](https://getpino.io/) for high-performance, structured logging with automatic environment detection:

#### Development Mode (Pretty Formatted)
```bash
bun run dev        # stdio transport with pretty logs
bun run dev:http   # HTTP transport with pretty logs
```
Output example:
```
[23:34:29 UTC] INFO: Spotify MCP HTTP server running
    host: "127.0.0.1"
    port: 3001
[23:34:30 UTC] INFO: User token expired, refreshing...
[23:34:31 UTC] INFO: Access token refreshed successfully
```

#### Production Mode (Structured JSON)
```bash
NODE_ENV=production bun run mcp        # stdio transport
NODE_ENV=production bun run mcp:http   # HTTP transport
```
Output example:
```json
{"level":30,"time":"2025-09-25T23:34:29.123Z","msg":"Spotify MCP HTTP server running","host":"127.0.0.1","port":3001}
{"level":30,"time":"2025-09-25T23:34:30.456Z","msg":"User token expired, refreshing..."}
{"level":30,"time":"2025-09-25T23:34:31.789Z","msg":"Access token refreshed successfully"}
```

#### Log Level Control
```bash
LOG_LEVEL=debug bun run dev:http    # Levels: debug, info, warn, error (default: info)
```

#### Key Features
- ✅ **Structured logging** with contextual information (user IDs, error objects, operation details)
- ✅ **Environment-aware formatting** (colorized pretty output in dev, JSON in production)
- ✅ **Human-readable timestamps** in ISO 8601 format
- ✅ **Stderr output** for proper separation from application data
- ✅ **Performance optimized** using Pino's fast logging architecture
- ✅ **Rich context** including auth status, token information, and API responses

### Testing

The project uses Jest for testing. To run the tests:

```bash
npm test
```

To run tests in watch mode during development:

```bash
npm run test:watch
```

### HTTP Transport

For advanced use cases, this server also supports HTTP transport with integrated OAuth functionality. See [README_HTTP_TRANSPORT.md](./README_HTTP_TRANSPORT.md) for detailed information about:

- MCP Streamable HTTP transport setup
- Integrated Spotify OAuth flow
- Real-time token validation
- Dynamic environment loading
- Browser-based authorization
- Comprehensive testing

## 🔧 Troubleshooting

### Common Issues

**Docker Container Won't Start:**
```bash
# Check logs
docker-compose logs
# Restart services  
docker-compose down && docker-compose up -d
```

**Ngrok Tunnel Fails:**
- **ERR_NGROK_108**: Session limit reached. Check [dashboard](https://dashboard.ngrok.com/agents) for active sessions
- **ERR_NGROK_4018**: Need auth token. Add `NGROK_AUTHTOKEN` to `.env`
- **Domain issues**: Verify custom domain ownership in ngrok dashboard

**Authentication Problems:**
```bash
# Check auth status
curl http://localhost:3001/health
# Manual token refresh
curl -X POST http://localhost:3001/refresh-token
```

**Environment Variables:**
```bash
# Verify container environment
docker-compose exec spotimy-mcp env | grep SPOTIFY
# Source .env and restart
set -a && source .env && set +a && docker-compose restart
```

### Data Persistence

- **Tokens**: Stored in `spotimy_data` Docker volume
- **Config**: `.env` file mounted and synced
- **Reset**: `docker-compose down -v` removes all data

### Performance

- **Memory**: ~50MB per container
- **CPU**: Minimal when idle, moderate during API calls  
- **Network**: Outbound to Spotify API and ngrok
- **Storage**: <10MB for logs and tokens

### Contributing

To contribute:
1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Add tests for your changes
4. Commit your changes (`git commit -m 'Add some amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

## License

MIT License

[![smithery badge](https://smithery.ai/badge/@superseoworld/artistlens)](https://smithery.ai/server/@superseoworld/artistlens)
