# Spotify MCP Server

> **Note**: This project is based on the original [ArtistLens](https://github.com/superseoworld/artistlens) by Thomas Wawra, but has been significantly modified and is now maintained as a separate project focused on enhanced HTTP transport, OAuth integration, and modern logging capabilities.

A powerful Model Context Protocol (MCP) server that provides access to the Spotify Web API. This server enables seamless interaction with Spotify's music catalog, including searching for tracks, albums, and artists, as well as accessing artist-specific information like top tracks and related artists.

**Current Version:** 0.9.0

## Features

- ✅ **Multi-user OAuth** - Per-session Spotify authorization with secure token storage
- ✅ **HTTP Transport** - Server-Sent Events (SSE) for real-time MCP communication
- ✅ **Dynamic Client Registration** - RFC 7591 compliant OAuth client registration
- ✅ **MCP Authorization Discovery** - Full MCP spec 2.3.2 & 2.3.4 implementation
- ✅ **PKCE Support** - Secure OAuth flow with code challenge validation
- ✅ **Automatic Token Refresh** - Tokens refreshed automatically when expired
- ✅ **Structured Output Schemas** - All 28 tools have defined output schemas for validation and structured responses (MCP 2024-11-05+)
- ✅ **Modern Logging** - Pino-based structured logging with environment-aware formatting
- ✅ **Docker Support** - Complete Docker setup with ngrok tunneling
- ✅ **Cloudflare Containers** - Deploy to Cloudflare's edge network with zero code changes

## Quick Start (Docker)

The easiest way to get started is with Docker, which includes both the MCP server and ngrok tunneling:

```bash
# Clone the repository
git clone https://github.com/srikanthrc/spotimy.git
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

## Configuration

### Required Environment Variables

Create a `.env` file with these required variables:

```env
# Get these from https://developer.spotify.com/dashboard
SPOTIFY_CLIENT_ID=your_client_id_here
SPOTIFY_CLIENT_SECRET=your_client_secret_here

# Server configuration  
HTTP_HOST=0.0.0.0
HTTP_PORT=3001

# Redirect URI (must match Spotify app settings)
SPOTIFY_REDIRECT_URI=http://localhost:3001/callback

# Ngrok configuration (recommended for public access)
NGROK_AUTH_TOKEN=your_ngrok_auth_token
NGROK_DOMAIN=your-custom-domain.ngrok.dev  # Optional: requires paid ngrok plan
```

### Getting Credentials

**Spotify API:**
1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app and copy Client ID & Secret
3. Add redirect URI: `http://localhost:3001/callback` (or your ngrok domain)

**Ngrok (Optional):**
1. Sign up at [ngrok.com](https://ngrok.com) 
2. Get your auth token from [dashboard](https://dashboard.ngrok.com/get-started/your-authtoken)
3. Add to `.env` for stable tunnels and custom domains

## Architecture

### Current Implementation

**HTTP Transport** (Primary)
- Multi-client MCP server using Server-Sent Events (SSE)
- Integrated OAuth flow with `/auth`, `/callback`, `/revoke` endpoints
- Multi-user session management with encrypted SQLite token storage
- Session management via `SSEServerTransport`
- Health checks at `/health?sessionId=<id>` with real-time auth validation
- Ngrok tunnel status reporting

### Core Components

**AuthManager** ([src/utils/auth.ts](src/utils/auth.ts))
- Per-session OAuth authorization with PKCE support
- Token validation against Spotify API
- Automatic token refresh using refresh tokens
- Returns detailed auth status for health checks

**TokenStore** ([src/utils/token-store.ts](src/utils/token-store.ts))
- Secure token storage with AES-256-GCM encryption
- SQLite database (`data/tokens.db`) for persistence
- Session-to-user mapping
- Automatic token expiry cleanup

**ClientRegistrationManager** ([src/utils/client-registration.ts](src/utils/client-registration.ts))
- OAuth 2.0 dynamic client registration (RFC 7591)
- Stores client metadata in SQLite database (`data/clients.db`)
- Validates client credentials and redirect URIs
- Supports PKCE authentication (`token_endpoint_auth_method: "none"`)

**SpotifyApi** ([src/utils/api.ts](src/utils/api.ts))
- Centralized API request handler
- Automatic Bearer token injection (per-session)
- Error transformation to MCP format
- Query string building utility

**Handlers** ([src/handlers/](src/handlers/))
- Domain-specific handlers: `ArtistsHandler`, `AlbumsHandler`, `TracksHandler`, `AudiobooksHandler`, `PlaylistsHandler`, `SearchHandler`
- Each handler encapsulates related Spotify API endpoints
- All handlers depend on `SpotifyApi` instance
- Tool responses formatted with `formatToolResponse()` helper to include both `content` and `structuredContent`

### OAuth Flow (Current Implementation)

**For Registered Clients (Dynamic Registration):**
1. Client registers via `POST /register` → receives `client_id` and `client_secret`
2. Client initiates authorization with `client_id`, `redirect_uri`, `code_challenge` (PKCE)
3. User visits `/auth` → redirects to Spotify with PKCE challenge
4. Spotify redirects to `/callback?code=...`
5. Server exchanges code for tokens → generates authorization code for client
6. Client exchanges authorization code for access token via `POST /token` (with `code_verifier` for PKCE)
7. Tokens saved to SQLite database (per-session)

**For Direct Session Authorization:**
1. User visits `/auth?sessionId=<id>` → HTML page with "Authorize" button
2. Redirects to Spotify with PKCE challenge
3. Spotify redirects to `/callback?code=...`
4. Server exchanges code for tokens via `AuthManager.exchangeCodeForTokens()`
5. Tokens saved to SQLite database (per-session)
6. `/health` endpoint validates token in real-time

### MCP Authorization Discovery

The server implements MCP Authorization Server Discovery (MCP spec 2.3.2 & 2.3.4):

1. **Unauthenticated Request**: Client connects to `/mcp` without credentials
2. **401 Response**: Server returns HTTP 401 with `WWW-Authenticate` header containing `resource_metadata` URL
3. **Metadata Discovery**: Client fetches `/mcp-metadata` to discover authorization endpoints
4. **Well-Known Fallback**: Client can probe `/.well-known/oauth-protected-resource` for metadata
5. **Authorization Server Metadata**: Client fetches `/authorize` to get OAuth 2.1 metadata
6. **OAuth Flow**: User authorizes via Spotify OAuth (see above)
7. **Authenticated Connection**: Client connects with valid session token

## Endpoints

### MCP Endpoints
- `GET /sse?sessionId=<id>` - SSE connection (requires auth)
- `POST /sse?sessionId=<id>` - MCP message endpoint

### Authorization Discovery (MCP Spec)
- `GET /mcp-metadata` - Resource metadata endpoint
- `GET /.well-known/oauth-protected-resource` - Protected resource metadata
- `GET /.well-known/oauth-authorization-server` - OAuth 2.0 AS metadata (RFC 8414)
- `GET /authorize` - Authorization server metadata
- `POST /register` - Dynamic client registration (RFC 7591)
- `POST /token` - Token endpoint (OAuth token exchange)

### OAuth Flow
- `GET /auth?sessionId=<id>` - Start Spotify OAuth for session
- `GET /callback` - Spotify OAuth callback
- `POST /revoke?sessionId=<id>` - Revoke session authorization

### Utility
- `GET /health?sessionId=<id>` - Health check (session-specific)
- `GET /favicon.ico` - Favicon image

## Available Tools

All 28 tools have defined `outputSchema` definitions that provide:

- **Structured Responses**: Tool results are returned as `structuredContent` matching the schema (MCP 2024-11-05+)
- **Validation**: Clients can validate responses against the defined schema
- **Type Safety**: Clear type definitions for all response fields
- **Documentation**: Schema includes descriptions for all fields

Each tool returns both `content` (text representation for backward compatibility) and `structuredContent` (structured JSON matching the `outputSchema`). This enables clients to:
- Parse and validate responses automatically
- Provide better type hints and autocomplete
- Render structured data intelligently
- Handle errors more gracefully

**Tools with output schemas:**

### Authentication
- `get_session_info` - Get current session ID and authentication status
- `get_access_token` - Get a valid Spotify access token

### Search
- `search` - Search for tracks, albums, artists, or playlists

### Artists
- `get_artist` - Get Spotify catalog information for an artist
- `get_multiple_artists` - Get information for multiple artists
- `get_artist_top_tracks` - Get an artist's top tracks
- `get_artist_related_artists` - Get artists similar to a given artist
- `get_artist_albums` - Get an artist's albums

### Albums
- `get_album` - Get album information
- `get_album_tracks` - Get an album's tracks
- `get_multiple_albums` - Get information for multiple albums
- `get_new_releases` - Get new album releases

### Tracks
- `get_track` - Get track information
- `get_recommendations` - Get track recommendations based on seeds
- `get_available_genres` - Get a list of available genres
- `get_user_top_tracks` - Get the current user's top tracks

### Audiobooks
- `get_audiobook` - Get audiobook information
- `get_multiple_audiobooks` - Get information for multiple audiobooks
- `get_audiobook_chapters` - Get chapters of an audiobook

### Playlists
- `get_playlist` - Get a playlist owned by a Spotify user
- `get_playlist_tracks` - Get full details of the tracks of a playlist
- `get_playlist_items` - Get full details of the items of a playlist
- `get_current_user_playlists` - Get playlists owned or followed by current user
- `get_featured_playlists` - Get Spotify featured playlists
- `get_category_playlists` - Get playlists tagged with a particular category
- `modify_playlist` - Change playlist details
- `add_tracks_to_playlist` - Add tracks to a playlist
- `remove_tracks_from_playlist` - Remove tracks from a playlist

## Local Development

### Prerequisites
- [Bun](https://bun.sh) (recommended) or Node.js 18+
- Spotify API credentials

### Setup

```bash
# Install dependencies
bun install

# Build the project
bun run build

# Run HTTP transport server (primary)
bun run dev:http   # Development mode (port 3001)
bun run mcp:http   # Production mode
```

### Development Commands

```bash
bun run build        # Compile TypeScript to build/
bun run watch        # TypeScript watch mode
bun run mcp:http     # Run production HTTP server
bun test             # Run all tests
```

### Testing

- OAuth flow: Visit `http://localhost:3001/auth?sessionId=<id>` in browser
- Health check: `curl http://localhost:3001/health?sessionId=<id> | jq`
- Revoke session: `curl -X POST http://localhost:3001/revoke?sessionId=<id>`
- Ngrok status: `curl http://localhost:4040/api/tunnels` (when using Docker)

## Docker Usage

### Service URLs
- **Local Health**: http://localhost:3001/health
- **Start Auth**: http://localhost:3001/auth  
- **Ngrok Dashboard**: http://localhost:4040
- **Public URL**: Shown in logs/dashboard

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

### Data Persistence

- **Tokens**: Stored in `spotimy_data` Docker volume (`/app/data/tokens.db`)
- **Client Registrations**: Stored in `spotimy_data` Docker volume (`/app/data/clients.db`)
- **Config**: `.env` file mounted and synced
- **Reset**: `docker-compose down -v` removes all data

## Logging

This server uses [Pino](https://getpino.io/) for high-performance, structured logging with automatic environment detection:

- **Development**: Pretty formatted, colorized output
- **Production**: Structured JSON output
- **Log Levels**: `debug`, `info`, `warn`, `error` (default: `info`)
- **Control**: Set `LOG_LEVEL` environment variable

## Troubleshooting

### Docker Container Won't Start
```bash
# Check logs
docker-compose logs
# Restart services  
docker-compose down && docker-compose up -d
```

### Ngrok Tunnel Fails
- **ERR_NGROK_108**: Session limit reached. Check [dashboard](https://dashboard.ngrok.com/agents) for active sessions
- **ERR_NGROK_4018**: Need auth token. Add `NGROK_AUTH_TOKEN` to `.env`
- **Domain issues**: Verify custom domain ownership in ngrok dashboard

### Authentication Problems
```bash
# Check auth status (replace <sessionId> with your actual session ID)
curl http://localhost:3001/health?sessionId=<sessionId>
# Token refresh is automatic - just re-authorize if needed
curl http://localhost:3001/auth?sessionId=<sessionId>
# Or revoke and start fresh
curl -X POST http://localhost:3001/revoke?sessionId=<sessionId>
```

### Environment Variables
```bash
# Verify container environment
docker-compose exec mcp env | grep SPOTIFY
# Restart to reload environment
docker-compose restart
```

### Invalid Client Error (OAuth)
If you get `invalid_client` errors:

1. **Check Spotify Redirect URI**: Must match exactly (including `http://` vs `https://`)
2. **Verify PKCE**: Client should send `code_verifier` for PKCE flow
3. **Check Client Registration**: Ensure client is registered via `/register` endpoint

## Deployment

### Cloudflare Workers (Containers)

The MCP server can be deployed to Cloudflare using [Cloudflare Containers](https://developers.cloudflare.com/containers/) which runs the existing Docker image on Cloudflare's edge network.

**Live URL:** `https://vermillion-spotify-mcp.vermillion-a04.workers.dev`

#### Quick Deploy

```bash
cd workers/vermillion-spotify-mcp

# Set Spotify credentials as secrets
bunx wrangler secret put SPOTIFY_CLIENT_ID
bunx wrangler secret put SPOTIFY_CLIENT_SECRET

# Deploy
bunx wrangler deploy
```

#### Endpoints

| Endpoint | Description |
|----------|-------------|
| `/` | Worker status and configuration |
| `/health` | Container health check |
| `/auth?sessionId=<id>` | Start Spotify OAuth |
| `/sse?sessionId=<id>` | MCP SSE transport |
| `/callback` | OAuth callback |

#### Configuration

The Worker is configured in `workers/vermillion-spotify-mcp/wrangler.jsonc`:

- **Container Image**: Built from `Dockerfile.cloudflare` (simplified, no ngrok)
- **Always-on**: `sleepAfter = "168h"` keeps container running continuously
- **Secrets**: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` (set via `wrangler secret`)
- **Environment**: `WORKER_URL` set in `vars` for OAuth redirect URI

#### Monitoring Logs

**Real-time log streaming:**
```bash
cd workers/vermillion-spotify-mcp
bunx wrangler tail --format=pretty
```

**Filter options:**
```bash
bunx wrangler tail --format=json          # JSON output for parsing
bunx wrangler tail --status=error         # Only errors
bunx wrangler tail --status=ok            # Only successful requests
```

**Cloudflare Dashboard:**
Navigate to Workers & Pages → vermillion-spotify-mcp → Observability

#### Container Management

```bash
# List container instances
bunx wrangler containers list

# View container health
bunx wrangler containers list | jq '.[0].health'

# Delete container (forces fresh restart)
bunx wrangler containers delete <application-id>
```

#### Updating the Deployment

```bash
cd workers/vermillion-spotify-mcp
bunx wrangler deploy
```

The container image is rebuilt and deployed automatically. Changes to `src/` require rebuilding the main project first:

```bash
# From project root
bun run build
cd workers/vermillion-spotify-mcp
bunx wrangler deploy
```

#### Spotify App Configuration

Add this redirect URI to your Spotify app:
```
https://vermillion-spotify-mcp.vermillion-a04.workers.dev/callback
```

### Google Cloud Platform

For production deployment on Google Cloud Platform, see [GCP_DEPLOYMENT.md](./GCP_DEPLOYMENT.md).

## Project Structure

```
src/
├── handlers/         # Domain-specific API handlers
├── types/            # TypeScript interfaces
├── utils/            # Utilities (auth, api, logger, token-store, client-registration)
├── http-server.ts    # HTTP transport server (primary)
└── __tests__/        # Test files

workers/
└── vermillion-spotify-mcp/
    ├── src/index.ts   # Cloudflare Container wrapper
    ├── wrangler.jsonc # Worker configuration
    └── package.json   # Worker dependencies

data/                 # Runtime data (created automatically)
├── tokens.db         # Encrypted token storage (SQLite)
└── clients.db        # Client registration storage (SQLite)

Dockerfile.cloudflare  # Simplified Docker image for Cloudflare Containers
```

## License

MIT License

## Support

- **GitHub Issues**: https://github.com/srikanthrc/spotimy/issues
- **MCP Specification**: https://github.com/modelcontextprotocol/specification

---

> **Note**: This project evolved from the original [ArtistLens](https://github.com/superseoworld/artistlens) but has been significantly refactored for multi-user OAuth, HTTP transport, and production deployment. The current implementation uses SQLite for token storage and supports dynamic client registration per MCP specification.
