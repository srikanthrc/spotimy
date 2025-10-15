# MCP Authorization Server Discovery

This server implements the [MCP Authorization Server Discovery](https://modelcontextprotocol.io/specification/draft/basic/authorization#authorization-server-metadata-discovery) flow as specified in sections 2.3.2 and 2.3.4 of the MCP specification.

## Overview

The MCP server now follows the proper authorization discovery flow:

1. **Unauthenticated Request**: When a client attempts to connect without authentication, the server returns HTTP 401 with a `WWW-Authenticate` header containing the resource metadata URL.
2. **Resource Metadata Discovery**: The client fetches the resource metadata to discover the authorization server.
3. **Authorization Flow**: The client follows the OAuth 2.1 authorization flow.
4. **Authenticated Connection**: Once authorized, the client can connect to the MCP endpoint.

## Endpoints

### Authorization Discovery

#### `GET /mcp` (Unauthenticated)
Returns 401 with discovery headers including required scopes (RFC 6750 Section 3):
```http
HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="http://localhost:3001", resource_metadata="http://localhost:3001/mcp-metadata", scope="playlist-read-private playlist-read-collaborative user-read-private user-top-read playlist-modify-public playlist-modify-private"
Content-Type: application/json

{
  "error": "unauthorized",
  "error_description": "Authentication required. Please obtain authorization.",
  "authorization_endpoint": "http://localhost:3001/auth",
  "resource_metadata": "http://localhost:3001/mcp-metadata",
  "documentation": "https://github.com/modelcontextprotocol/specification"
}
```

#### `GET /mcp-metadata`
Returns resource server metadata:
```json
{
  "authorizationEndpoint": "http://localhost:3001/authorize",
  "tokenEndpoint": "http://localhost:3001/token",
  "resourceServer": "http://localhost:3001",
  "mcpEndpoint": "http://localhost:3001/mcp",
  "scopes": [
    "playlist-read-private",
    "playlist-read-collaborative",
    "user-read-private",
    "user-top-read",
    "playlist-modify-public",
    "playlist-modify-private"
  ]
}
```

#### `GET /.well-known/oauth-protected-resource`
Well-known endpoint for fallback discovery (per MCP spec):
```json
{
  "authorizationServer": "http://localhost:3001/authorize",
  "tokenEndpoint": "http://localhost:3001/token",
  "resourceMetadata": "http://localhost:3001/mcp-metadata",
  "mcpEndpoint": "http://localhost:3001/mcp"
}
```

#### `GET /.well-known/oauth-authorization-server`
OAuth 2.0 Authorization Server Metadata endpoint (RFC 8414):
```json
{
  "issuer": "http://localhost:3001",
  "authorization_endpoint": "http://localhost:3001/auth",
  "token_endpoint": "http://localhost:3001/token",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "scopes_supported": [...],
  "token_endpoint_auth_methods_supported": ["client_secret_post", "client_secret_basic"]
}
```

#### `GET /authorize`
Returns OAuth 2.1 / OpenID Connect Discovery metadata:
```json
{
  "issuer": "http://localhost:3001",
  "authorization_endpoint": "http://localhost:3001/auth",
  "token_endpoint": "http://localhost:3001/token",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "scopes_supported": [...],
  "token_endpoint_auth_methods_supported": ["client_secret_post", "client_secret_basic"]
}
```

### OAuth Flow

#### `GET /auth?sessionId=<id>`
Initiates the Spotify OAuth flow for a specific session. Returns HTML page with authorization button.

#### `GET /callback`
OAuth callback endpoint that receives the authorization code from Spotify and exchanges it for tokens.

#### `POST /revoke?sessionId=<id>`
Revokes authorization for a specific session.

### MCP Connection (Authenticated)

#### `GET /mcp?sessionId=<id>`
Establishes SSE connection for MCP protocol (requires valid session authorization).

#### `POST /mcp?sessionId=<id>`
Sends MCP messages (requires valid session authorization).

## Testing the Authorization Discovery Flow

### 1. Test Unauthenticated Request
```bash
curl -v http://localhost:3001/mcp
```

Expected response:
- HTTP 401 Unauthorized
- `WWW-Authenticate` header with resource_metadata URL
- JSON body with error details and discovery URLs

### 2. Test Resource Metadata Discovery
```bash
curl http://localhost:3001/mcp-metadata | jq
```

Expected response:
- Resource server metadata with authorization endpoints

### 3. Test Well-Known Endpoints

#### Protected Resource Metadata
```bash
curl http://localhost:3001/.well-known/oauth-protected-resource | jq
```

Expected response:
- Protected resource metadata for MCP fallback discovery

#### Authorization Server Metadata (RFC 8414)
```bash
curl http://localhost:3001/.well-known/oauth-authorization-server | jq
```

Expected response:
- OAuth 2.0 Authorization Server metadata

### 4. Test Authorization Server Metadata Endpoint
```bash
curl http://localhost:3001/authorize | jq
```

Expected response:
- OAuth 2.1 authorization server metadata

### 5. Complete Authorization Flow

#### Step 1: Generate a session ID
```bash
SESSION_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
echo "Session ID: $SESSION_ID"
```

#### Step 2: Attempt unauthenticated connection
```bash
curl -v "http://localhost:3001/mcp?sessionId=$SESSION_ID"
```

You'll get a 401 with the resource metadata URL.

#### Step 3: Fetch resource metadata
```bash
curl "http://localhost:3001/mcp-metadata" | jq
```

#### Step 4: Authorize the session
Open in browser:
```
http://localhost:3001/auth?sessionId=$SESSION_ID
```

Click "Authorize with Spotify" and complete the OAuth flow.

#### Step 5: Connect with authenticated session
```bash
curl "http://localhost:3001/mcp?sessionId=$SESSION_ID"
```

Now you should successfully connect to the MCP endpoint.

### 6. Test Token Validation

Attempt to connect with an invalid session:
```bash
curl -v "http://localhost:3001/mcp?sessionId=invalid-session-id"
```

Expected response:
- HTTP 401 Unauthorized
- `WWW-Authenticate` header with `error="invalid_token"`
- JSON body with authorization endpoint for re-authorization

## Sequence Diagram

The implementation follows this sequence:

```
Client                      MCP Server                  Spotify OAuth
  |                              |                              |
  |--MCP request (no auth)------>|                              |
  |<-----401 Unauthorized--------|                              |
  |   (WWW-Authenticate header   |                              |
  |    with resource_metadata)   |                              |
  |                              |                              |
  |--GET resource_metadata------>|                              |
  |<--Resource metadata----------|                              |
  |   (authorization endpoints)  |                              |
  |                              |                              |
  |--GET authorization server--->|                              |
  |<--OAuth 2.1 metadata---------|                              |
  |                              |                              |
  |--Initiate OAuth flow-------->|                              |
  |                              |----Redirect to Spotify------>|
  |                              |                              |
  |<--Authorization code---------|<-----------------------------|
  |                              |                              |
  |--Exchange code for token---->|--Token exchange------------->|
  |                              |<-Access token----------------|
  |<--Success--------------------|                              |
  |                              |                              |
  |--MCP request with token----->|                              |
  |<--MCP response---------------|                              |
  |                              |                              |
```

## Key Implementation Details

### Authentication Check
The server checks for authentication on every MCP request (GET and POST):
- Checks for `sessionId` query parameter
- Validates session has an active, non-expired token
- Returns 401 with discovery headers if unauthenticated or invalid

### Base URL Resolution
The server intelligently determines its base URL for metadata:
1. Uses `NGROK_DOMAIN` if configured (for tunneling)
2. Uses `X-Forwarded-Host` and `X-Forwarded-Proto` headers if behind proxy
3. Falls back to configured `HTTP_HOST` and `HTTP_PORT`

### Session Management
Each MCP connection maintains:
- Transport session ID (auto-generated by SSE transport)
- Custom session ID (provided by client)
- Token mapping (session ID → user token)

### Token Validation
The server validates tokens on:
- Initial connection (GET /mcp)
- Every message (POST /mcp)
- Returns 401 with re-authorization endpoint if expired

## Compliance with MCP Specification

This implementation follows the MCP Authorization specification:
- ✅ Returns 401 with `WWW-Authenticate` header containing `resource_metadata`
- ✅ Includes `scope` parameter in `WWW-Authenticate` header (RFC 6750 Section 3)
- ✅ Provides resource metadata endpoint
- ✅ Supports well-known URI fallback (both MCP and OAuth 2.0 formats)
- ✅ Returns OAuth 2.1 authorization server metadata
- ✅ Validates tokens on every request
- ✅ Provides clear error messages with re-authorization endpoints

## Migration Notes

### For Existing Clients
Clients can still use the direct authorization URL if they already have a session ID:
```
http://localhost:3001/auth?sessionId=<id>
```

### For New Clients
New clients should follow the discovery flow:
1. Attempt to connect to `/mcp`
2. Parse the 401 response to get `resource_metadata` URL
3. Fetch resource metadata
4. Follow the authorization flow
5. Connect with authenticated session

## Environment Variables

Required:
- `SPOTIFY_CLIENT_ID` - Spotify application client ID
- `SPOTIFY_CLIENT_SECRET` - Spotify application client secret

Optional:
- `HTTP_HOST` - Server host (default: 127.0.0.1)
- `HTTP_PORT` - Server port (default: 3001)
- `NGROK_DOMAIN` - Ngrok domain for tunneling
- `SPOTIFY_REDIRECT_URI` - Override redirect URI (default: auto-generated)

## References

- [MCP Specification - Authorization](https://modelcontextprotocol.io/specification/draft/basic/authorization)
- [OAuth 2.1 Authorization Framework](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1)
- [RFC 6750 - Bearer Token Usage](https://datatracker.ietf.org/doc/html/rfc6750)

