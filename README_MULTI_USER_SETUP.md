# Multi-User OAuth Setup Guide

This guide explains the new multi-user OAuth architecture introduced in version 0.5.0.

## Overview

The Spotify MCP Server now supports **multiple users** with independent OAuth authorization per MCP session. Key features:

- **Per-session authorization:** Each MCP client session can authenticate as a different Spotify user
- **Secure token storage:** Encrypted SQLite database instead of `.env` file
- **Automatic token refresh:** Tokens are refreshed automatically when expired
- **Session isolation:** Each user's tokens are isolated to their session(s)

## Architecture

```
┌──────────────┐         ┌──────────────────────────────┐
│ MCP Client 1 │◄───────►│  MCP Server (HTTP Transport) │
└──────────────┘         │                               │
    sessionId: abc       │  ┌─────────────────────────┐  │
    User: alice@email    │  │   AuthManager           │  │
                         │  │   - Session management  │  │
┌──────────────┐         │  │   - OAuth flow          │  │
│ MCP Client 2 │◄───────►│  │   - Token refresh       │  │
└──────────────┘         │  └─────────────────────────┘  │
    sessionId: xyz       │                               │
    User: bob@email      │  ┌─────────────────────────┐  │
                         │  │   TokenStore (SQLite)   │  │
                         │  │   - Encrypted DB        │  │
                         │  │   - Session→User map    │  │
                         │  └─────────────────────────┘  │
                         └──────────────────────────────┘
```

## Quick Start

### 1. Initial Setup

```bash
# Install dependencies
bun install

# Build the project
bun run build

# Start the HTTP server
bun run mcp:http
```

The server will start on `http://127.0.0.1:3001` (or your configured `HTTP_PORT`).

### 2. Connect an MCP Client

Connect your MCP client to the server. The client will receive a unique `sessionId` from the SSE transport.

Example MCP client configuration:
```json
{
  "mcpServers": {
    "spotify": {
      "url": "http://127.0.0.1:3001/mcp"
    }
  }
}
```

### 3. Authorize Your Session

Once connected, you need to authorize your session:

1. Get your `sessionId` from the MCP client connection logs
2. Open your browser and visit:
   ```
   http://127.0.0.1:3001/auth?sessionId=YOUR_SESSION_ID
   ```
3. Click "Authorize Spotify Access"
4. Log in to Spotify and grant permissions
5. You'll be redirected back with a success message

Your session is now authorized! All MCP tool calls will use your Spotify account.

### 4. Verify Authorization

Check your session's authorization status:

```bash
curl "http://127.0.0.1:3001/health?sessionId=YOUR_SESSION_ID" | jq
```

Expected response:
```json
{
  "status": "ok",
  "message": "Spotify MCP Server is running (Multi-user mode)",
  "timestamp": "2025-10-14T...",
  "auth": {
    "status": "Authorized",
    "authenticated": true,
    "sessionId": "abc123...",
    "userId": "your_spotify_user_id",
    "spotifyUserId": "your_spotify_user_id",
    "displayName": "Your Name",
    "email": "you@example.com",
    "expiresAt": "2025-10-14T...",
    "expiresInMinutes": 58
  },
  "stats": {
    "userCount": 1,
    "sessionCount": 1,
    "activeTokenCount": 1
  }
}
```

## Migrating from Old .env Tokens

If you previously used the server with tokens in your `.env` file, you can migrate them:

```bash
bun src/utils/migrate-tokens.ts
```

This will:
1. Read tokens from your `.env` file
2. Validate them against Spotify API
3. Create an encrypted database entry
4. Link the tokens to a migration session ID
5. Provide instructions for cleanup

After migration, you can safely remove these from `.env`:
- `SPOTIFY_USER_ACCESS_TOKEN`
- `SPOTIFY_REFRESH_TOKEN`
- `SPOTIFY_AUTH_CODE`
- `SPOTIFY_TOKEN_EXPIRES_AT`

**Keep these in `.env`:**
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`

## Token Storage

### Database Location

Tokens are stored in an encrypted SQLite database:
- **Database:** `./data/tokens.db`
- **Encryption Key:** `./data/.encryption-key`

### Encryption

- Algorithm: **AES-256-GCM**
- Each sensitive field (access_token, refresh_token) is encrypted separately
- Encryption key is auto-generated on first run
- Authentication tags ensure data integrity

### Backup

**IMPORTANT:** Back up these files to prevent data loss:
```bash
# Backup command
cp -r ./data ./data-backup-$(date +%Y%m%d)
```

Both files are required to decrypt tokens. Losing the encryption key means losing access to all stored tokens.

## Environment Variables

### Required

```env
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
```

### Optional

```env
# Server configuration
HTTP_HOST=0.0.0.0
HTTP_PORT=3001

# Token storage
TOKEN_STORE_PATH=./data
TOKEN_ENCRYPTION_KEY=...  # 64-char hex, auto-generated if not provided

# Ngrok (for Docker deployments)
NGROK_AUTH_TOKEN=...
NGROK_DOMAIN=...
```

## API Endpoints

### GET /auth?sessionId=<id>
Start OAuth authorization flow for a session.

**Response:** HTML page with "Authorize" button

### GET /callback
OAuth callback endpoint (handled automatically by Spotify redirect).

### GET /health?sessionId=<id>
Check health and authorization status.

**Query Parameters:**
- `sessionId` (optional): Check specific session status

**Response:**
```json
{
  "status": "ok",
  "message": "Spotify MCP Server is running (Multi-user mode)",
  "auth": { ... },
  "stats": { ... },
  "forwarding": { ... }
}
```

### POST /revoke?sessionId=<id>
Revoke authorization for a session.

**Response:**
```json
{
  "success": true,
  "message": "Session authorization revoked successfully"
}
```

### GET /mcp
MCP SSE endpoint for client connections.

### POST /mcp?sessionId=<id>
MCP message endpoint for tool calls.

## Security Considerations

### Token Encryption
- All sensitive tokens are encrypted at rest
- Encryption key must be kept secure
- Keys are never logged or exposed via API

### Session Isolation
- Each session is isolated with its own authorization
- Sessions cannot access other users' tokens
- CSRF protection via OAuth state parameter

### Production Deployment
For production:
1. Set `TOKEN_ENCRYPTION_KEY` explicitly (don't rely on auto-generation)
2. Use HTTPS/TLS for all connections
3. Restrict network access to MCP endpoints
4. Regular backups of token database
5. Monitor session activity via `/health` endpoint

## Docker Deployment

The `docker-compose.yml` has been updated for multi-user mode:

```yaml
volumes:
  - spotimy_data:/app/data  # Persistent encrypted token storage
  - ./.env:/app/.env:ro     # Read-only (no more token writes)

environment:
  - TOKEN_STORE_PATH=/app/data
  - TOKEN_ENCRYPTION_KEY=${TOKEN_ENCRYPTION_KEY:-}
```

Start the container:
```bash
docker-compose up -d
```

Authorize sessions same as above, using the exposed port (default 3001).

## Troubleshooting

### Session Not Found
- Ensure you're using the correct `sessionId` from your MCP client
- Check that your MCP client is still connected

### Token Expired
- Tokens refresh automatically when expired
- If refresh fails, re-authorize via `/auth?sessionId=<id>`

### Database Locked
- Only one process can access the database at a time
- Ensure no other instances of the server are running

### Migration Failed
- Check that your `.env` tokens are still valid
- Verify `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` are set
- Run migration with: `LOG_LEVEL=debug bun src/utils/migrate-tokens.ts`

## Monitoring

### Check Statistics
```bash
curl http://127.0.0.1:3001/health | jq '.stats'
```

Returns:
```json
{
  "userCount": 3,
  "sessionCount": 5,
  "activeTokenCount": 3
}
```

### Session-Specific Status
```bash
curl "http://127.0.0.1:3001/health?sessionId=<id>" | jq '.auth'
```

## FAQ

**Q: Can multiple sessions use the same Spotify account?**
A: Yes! You can authorize multiple sessions with the same Spotify user. Each session will have independent authorization.

**Q: What happens if I lose my encryption key?**
A: All stored tokens become inaccessible. You'll need to re-authorize all sessions. Back up your `./data/.encryption-key` file!

**Q: Can I use stdio transport with multi-user mode?**
A: The stdio transport ([src/index.ts](src/index.ts)) uses the old single-user model. Multi-user mode requires HTTP transport.

**Q: How do I revoke all sessions for a user?**
A: Currently, you need to revoke each session individually via `/revoke?sessionId=<id>`. Or delete the user from the database directly.

**Q: Where can I find my sessionId?**
A: The `sessionId` is returned by the MCP server when your client connects via SSE. Check your MCP client logs or connection info.

## Support

For issues or questions:
- GitHub Issues: https://github.com/superseoworld/artistlens/issues
- Check logs: `docker-compose logs -f spotimy-mcp` (if using Docker)
- Enable debug logging: `LOG_LEVEL=debug bun run mcp:http`
