# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Spotify MCP Server** - A Model Context Protocol (MCP) server providing access to Spotify Web API. This is a fork of the original [ArtistLens](https://github.com/superseoworld/artistlens) with enhanced HTTP transport, OAuth integration, and modern logging.

**Key Enhancements:** 
- Integrated OAuth flow with HTTP transport eliminates the need for separate callback servers
- Full MCP Authorization Server Discovery implementation (MCP spec 2.3.2 & 2.3.4)

## Commands

### Development
```bash
bun run dev          # Run with stdio transport
bun run dev:http     # Run with HTTP transport + OAuth (port 3001)
bun run watch        # TypeScript watch mode
```

### Building & Production
```bash
bun run build        # Compile TypeScript to build/
bun run mcp          # Run production stdio server
bun run mcp:http     # Run production HTTP server
```

### Testing
```bash
bun test                                    # Run all tests
bun test src/__tests__/http-transport.test.ts  # Test HTTP transport
```

### Docker
```bash
./setup-docker.sh                  # Initial setup
./manage-docker.sh start|stop|logs # Manage services
./manage-docker.sh health          # Check server health
./manage-docker.sh auth            # Open OAuth flow
docker-compose up -d               # Start services
docker-compose logs -f spotimy-mcp # View logs
```

## Architecture

### Transport Modes

**Stdio Transport** ([src/index.ts](src/index.ts))
- Single-process MCP server using stdin/stdout
- Suitable for local integrations (Claude Desktop, Cline)
- Uses `StdioServerTransport`

**HTTP Transport** ([src/http-server.ts](src/http-server.ts))
- Multi-client MCP server using Server-Sent Events (SSE)
- Integrated OAuth flow with `/auth`, `/callback`, `/revoke` endpoints
- Multi-user session management with SQLite token storage
- Session management via `SSEServerTransport`
- Health checks at `/health?sessionId=<id>` with real-time auth validation
- Ngrok tunnel status reporting

### Core Components

**AuthManager** ([src/utils/auth.ts](src/utils/auth.ts))
- Dynamic environment variable loading (re-reads `.env` on each call)
- Token validation against Spotify API
- OAuth authorization flow with PKCE
- Automatic token refresh using refresh tokens
- Writes updated tokens back to `.env` file
- Returns detailed auth status for health checks

**SpotifyApi** ([src/utils/api.ts](src/utils/api.ts))
- Centralized API request handler
- Automatic Bearer token injection
- Error transformation to MCP format
- Query string building utility

**Handlers** ([src/handlers/](src/handlers/))
- Domain-specific handlers: `ArtistsHandler`, `AlbumsHandler`, `TracksHandler`, `AudiobooksHandler`, `PlaylistsHandler`, `SearchHandler`
- Each handler encapsulates related Spotify API endpoints
- All handlers depend on `SpotifyApi` instance

**Logger** ([src/utils/logger.ts](src/utils/logger.ts))
- Pino-based structured logging
- Environment-aware output: pretty (dev) vs JSON (production)
- Controlled by `NODE_ENV` and `LOG_LEVEL` variables
- Outputs to stderr for proper separation

### MCP Authorization Discovery Flow (HTTP Transport)

The server implements the full MCP Authorization Server Discovery flow:

1. **Unauthenticated Request**: Client attempts to connect to `/mcp` without credentials
2. **401 Response**: Server returns HTTP 401 with `WWW-Authenticate` header containing `resource_metadata` URL
3. **Metadata Discovery**: Client fetches `/mcp-metadata` to discover authorization endpoints
4. **Well-Known Fallback**: Client can also probe `/.well-known/oauth-protected-resource` for metadata
5. **Authorization Server Metadata**: Client fetches `/authorize` to get OAuth 2.1 metadata
6. **OAuth Flow**: User authorizes via Spotify OAuth
7. **Authenticated Connection**: Client connects with valid session token

See [README_MCP_AUTH_DISCOVERY.md](README_MCP_AUTH_DISCOVERY.md) for detailed documentation.

### OAuth Flow (HTTP Transport Only)

1. User visits `/auth?sessionId=<id>` → HTML page with "Authorize" button
2. Redirects to Spotify with PKCE challenge
3. Spotify redirects to `/callback?code=...`
4. Server exchanges code for tokens via `AuthManager.exchangeCodeForTokens()`
5. Tokens saved to SQLite database (per-session)
6. `/health` endpoint validates token in real-time

### Configuration

Required environment variables (`.env`):
```env
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
HTTP_HOST=0.0.0.0       # For HTTP transport
HTTP_PORT=3001          # For HTTP transport
```

Optional (obtained via OAuth):
```env
SPOTIFY_USER_ACCESS_TOKEN=...
SPOTIFY_REFRESH_TOKEN=...
SPOTIFY_AUTH_CODE=...
SPOTIFY_TOKEN_EXPIRES_AT=...
```

For ngrok tunneling (Docker):
```env
NGROK_AUTH_TOKEN=...
NGROK_DOMAIN=...  # Optional custom domain
```

**Important:** Spotify App redirect URI must be `http://127.0.0.1:3001/callback` (not `localhost`)

### MCP Tools

All tools follow the same pattern:
1. Defined in `setupToolHandlers()` with JSON schema
2. Validated via `validateArgs<T>()` helper
3. Delegated to appropriate handler
4. Results serialized as JSON text

Categories:
- **Search**: `search`
- **Artists**: `get_artist`, `get_multiple_artists`, `get_artist_top_tracks`, `get_artist_related_artists`, `get_artist_albums`
- **Albums**: `get_album`, `get_album_tracks`, `get_multiple_albums`, `get_new_releases`
- **Tracks**: `get_track`, `get_recommendations`, `get_available_genres`, `get_user_top_tracks`
- **Audiobooks**: `get_audiobook`, `get_multiple_audiobooks`, `get_audiobook_chapters`
- **Playlists**: `get_playlist`, `get_playlist_tracks`, `get_playlist_items`, `modify_playlist`, `add_tracks_to_playlist`, `remove_tracks_from_playlist`, `get_current_user_playlists`, `get_featured_playlists`, `get_category_playlists`
- **Auth**: `get_access_token`

## Development Guidelines

### Adding New Tools
1. Define TypeScript types in `src/types/`
2. Implement handler method in appropriate `src/handlers/` file
3. Add tool schema in `setupToolHandlers()` (both [src/index.ts](src/index.ts) and [src/http-server.ts](src/http-server.ts))
4. Add case in `CallToolRequestSchema` handler
5. Write tests in `src/__tests__/`

### Logging Best Practices
- Use structured logging: `logger.info({ context }, 'message')`
- Include contextual data (user IDs, token status, error objects)
- Let environment control formatting (don't hardcode pretty/json)
- Avoid logging full tokens (use `.substring(0, 20)`)

### Testing HTTP Transport
- OAuth flow: Visit `http://localhost:3001/auth?sessionId=<id>` in browser
- Health check: `curl http://localhost:3001/health?sessionId=<id> | jq`
- Revoke session: `curl -X POST http://localhost:3001/revoke?sessionId=<id>`
- Ngrok status: `curl http://localhost:4040/api/tunnels` (when using Docker)
- Token refresh: Automatic via AuthManager when token expires

### Docker Deployment
- `docker-compose.yml` runs both MCP server and ngrok sidecar
- Persistent storage via `spotimy_data` volume for tokens
- `.env` mounted and synced with container
- Health checks on port 3001
- Ngrok dashboard on port 4040
