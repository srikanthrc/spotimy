# MCP HTTP Transport with Integrated OAuth

The Spotify MCP server supports both traditional stdio transport and **MCP Streamable HTTP transport with fully integrated OAuth functionality**. This eliminates the need for separate callback server utilities and provides a complete, self-contained solution.

## Overview

The Streamable HTTP transport is the latest MCP transport mechanism that provides:

- **Single endpoint** for all MCP operations
- **Server-Sent Events (SSE)** for real-time streaming
- **Session management** and connection recovery
- **Multiple concurrent client connections**
- **Integrated OAuth flow** for Spotify authorization
- **Dynamic token management** without server restart
- **Real-time authentication validation**

## Quick Start

### 1. Start the Integrated Server
```bash
bun run mcp:http
```

### 2. Authorize via Browser
```bash
open http://localhost:3001/auth
```
Click "Authorize Spotify Access" → Complete Spotify authorization → Tokens automatically updated

### 3. Verify Status
```bash
curl http://localhost:3001/health | jq '.auth'
```

## Endpoints

### Core MCP Endpoints
- **`GET /mcp`** - Establishes SSE connection for MCP communication
- **`POST /mcp?sessionId=<id>`** - Sends MCP messages to the server

### OAuth Integration Endpoints
- **`GET /auth`** - OAuth authorization page with clickable button
- **`GET /callback`** - OAuth callback handler (auto-exchanges code for token)
- **`POST /refresh-token`** - Token refresh using existing auth code

### Utility Endpoints
- **`GET /health`** - Enhanced health check with real-time auth validation

## Features

### ✅ **Integrated OAuth Flow**
- **Browser-based authorization** with automatic token exchange
- **Dynamic environment loading** - tokens update without server restart
- **Real-time validation** - health endpoint tests tokens against Spotify API
- **Automatic `.env` updates** when tokens are refreshed

### ✅ **Enhanced Health Check**
```json
{
  "status": "ok",
  "auth": {
    "status": "User token active",
    "tokenValid": true,
    "hasUserToken": true,
    "hasAuthCode": true,
    "hasClientCredentials": true,
    "details": {
      "userToken": "BQCuqE1mGJ_iken4A-ZR...",
      "userId": "saturnatwork",
      "displayName": "Srikanth Chinmay"
    }
  }
}
```

### ✅ **MCP Transport Features**
- **Session Management**: Each connection gets a unique session ID
- **CORS Support**: Configured for cross-origin requests
- **Error Handling**: Comprehensive error handling and logging
- **Graceful Shutdown**: Proper cleanup of connections and resources
- **Multiple Clients**: Support concurrent connections

## Client Connection Process

### 1. Health Check (Optional)
```bash
curl http://localhost:3001/health
```

### 2. Establish SSE Connection
```javascript
const eventSource = new EventSource('http://localhost:3001/mcp');
```

### 3. Wait for Endpoint Event
```javascript
eventSource.addEventListener('endpoint', (event) => {
  const endpoint = 'http://localhost:3001' + decodeURI(event.data);
  // Now use this endpoint for POST requests
});
```

### 4. Send MCP Messages
```javascript
fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: { roots: { listChanged: false } },
      clientInfo: { name: 'my-client', version: '1.0.0' }
    }
  })
});
```

### 5. Listen for Responses
```javascript
eventSource.addEventListener('message', (event) => {
  const response = JSON.parse(event.data);
  console.log('MCP Response:', response);
});
```

## OAuth Authorization Flow

### Manual Browser Flow
1. Visit: `http://localhost:3001/auth`
2. Click "Authorize Spotify Access" button
3. Complete Spotify authorization
4. Automatically redirected back with success message
5. Tokens immediately available (no server restart needed)

### Programmatic Flow
```bash
# Start authorization (opens browser)
open http://localhost:3001/auth

# Check if tokens are valid
curl http://localhost:3001/health | jq '.auth.tokenValid'

# Refresh tokens if needed (using existing auth code)
curl -X POST http://localhost:3001/refresh-token
```

## Authentication Status

The `/health` endpoint provides detailed authentication information:

- **`status`**: Human-readable auth status
- **`tokenValid`**: Boolean indicating if token works with Spotify API
- **`hasUserToken`**: Boolean indicating if user token is present
- **`hasAuthCode`**: Boolean indicating if refresh code is available
- **`hasClientCredentials`**: Boolean indicating if client ID/secret are present
- **`details`**: Object with user info (when token is valid) or error details

## Migration from Separate Callback Server

### Old Workflow (Deprecated)
```bash
# Start MCP server
bun run mcp:http &

# Start separate callback server
bun callback-server.js &

# Coordinate between two servers and restart MCP when tokens change
```

### New Integrated Workflow
```bash
# Start integrated MCP server
bun run mcp:http

# Use browser for OAuth (no restart needed)
open http://localhost:3001/auth
```

## Testing

Run the comprehensive test suite:

```bash
bun test src/__tests__/http-transport.test.ts
```

The tests verify:
- MCP protocol functionality (initialize, tools/list, etc.)
- OAuth authorization page serving
- Callback handling (success, error, edge cases)
- Token refresh endpoint functionality
- Dynamic environment loading validation
- Enhanced health check verification
- Error handling for all endpoints

## Configuration

### Environment Variables
```env
HTTP_PORT=3001
HTTP_HOST=127.0.0.1
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_USER_ACCESS_TOKEN=your_user_token
SPOTIFY_AUTH_CODE=your_auth_code
```

**Important**: In your Spotify App settings on the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), make sure to add `http://127.0.0.1:3001/callback` as a redirect URI (not `localhost:3001`).

### Custom Port and Host
```bash
bun src/http-server.ts --port=8080 --host=0.0.0.0
```

## Transport Comparison

| Feature | Stdio Transport | HTTP Transport |
|---------|----------------|----------------|
| Multiple Clients | ❌ Single process | ✅ Multiple concurrent |
| Remote Access | ❌ Local only | ✅ Network accessible |
| Session Management | ❌ None | ✅ Session IDs |
| OAuth Integration | ❌ None | ✅ Fully integrated |
| Token Management | ❌ Manual | ✅ Automatic |
| Real-time Validation | ❌ None | ✅ Live API testing |
| Scalability | ❌ Limited | ✅ Highly scalable |
| Development | ✅ Simple debugging | ⚠️ Requires HTTP client |
| Performance | ✅ Direct pipe | ⚠️ Network overhead |

## Benefits

✅ **Single Server Process** - No need to coordinate multiple servers
✅ **No Port Conflicts** - Everything runs on port 3001
✅ **Streamlined UX** - Simple browser-based authorization flow
✅ **Auto Token Management** - Callback automatically updates both `.env` and live process
✅ **Zero Downtime** - Tokens update without server restart
✅ **Real-time Validation** - Health endpoint shows current token status
✅ **Comprehensive Testing** - Full test coverage of all functionality

## Troubleshooting

### Token Issues
```bash
# Check current auth status
curl http://localhost:3001/health | jq '.auth'

# Refresh expired tokens
curl -X POST http://localhost:3001/refresh-token

# Start fresh OAuth flow
open http://localhost:3001/auth
```

### Connection Issues
```bash
# Verify server is running
curl http://localhost:3001/health

# Check CORS headers
curl -v http://localhost:3001/health

# Test SSE connection
curl -H "Accept: text/event-stream" http://localhost:3001/mcp
```

The integrated HTTP transport provides a complete, production-ready solution for both MCP communication and Spotify OAuth management.