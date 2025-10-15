# Dynamic Client Registration (RFC 7591)

This document explains the OAuth 2.0 Dynamic Client Registration implementation that makes the Spotify MCP Server compatible with tools like MCP Inspector.

## Overview

The server now supports **OAuth 2.0 Dynamic Client Registration** (RFC 7591), which allows clients to register themselves automatically without pre-configuration. This is essential for the MCP Inspector's "Guided OAuth Flow" to work.

### Why This Matters

MCP Inspector expects authorization servers to support dynamic client registration. Without it, you'd see the error:
```
Failed to start OAuth flow: Incompatible auth server: does not support dynamic client registration
```

Our implementation solves this by:
1. Accepting dynamic client registrations via `/register` endpoint
2. Storing registered client metadata in a SQLite database
3. Validating client credentials during OAuth flows
4. Redirecting back to the client's registered redirect_uri after authorization

## Architecture

### Components

#### 1. **ClientRegistrationManager** ([src/utils/client-registration.ts](src/utils/client-registration.ts))
- Manages OAuth client registrations
- Stores client metadata in `data/clients.db` (bun:sqlite)
- Generates client_id and client_secret for each registration
- Validates client credentials and redirect URIs

#### 2. **OAuth Types** ([src/types/oauth.ts](src/types/oauth.ts))
- TypeScript interfaces for RFC 7591 compliance
- `ClientRegistrationRequest` - registration request body
- `ClientRegistrationResponse` - registration response with credentials
- `RegisteredClient` - stored client metadata

#### 3. **HTTP Server Integration** ([src/http-server.ts](src/http-server.ts))
- `/register` endpoint for client registration
- Updated `/auth` endpoint supporting both sessionId and standard OAuth parameters
- Updated `/callback` endpoint to redirect back to registered clients
- Metadata endpoints advertising registration support

## OAuth Flow for Registered Clients

### 1. Client Registration

**Request:**
```bash
POST /register
Content-Type: application/json

{
  "client_name": "MCP Inspector",
  "redirect_uris": ["http://localhost:6274/oauth/callback/debug"],
  "grant_types": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_method": "client_secret_post"
}
```

**Response:**
```json
{
  "client_id": "mcp_f07904df1c74de5fead40e23ca27881d8c",
  "client_secret": "generated_secret_here",
  "client_id_issued_at": 1708123456,
  "client_secret_expires_at": 0,
  "redirect_uris": ["http://localhost:6274/oauth/callback/debug"],
  "token_endpoint_auth_method": "client_secret_post",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "registration_access_token": "generated_token_here",
  "registration_client_uri": "https://splay.ngrok.dev/register/mcp_..."
}
```

### 2. Authorization Request

The client initiates authorization using standard OAuth 2.0 parameters:

```
GET /auth?response_type=code
    &client_id=mcp_f07904df1c74de5fead40e23ca27881d8c
    &redirect_uri=http://localhost:6274/oauth/callback/debug
    &state=690cc4997039a644d346
    &code_challenge=JcokcFm9JItjgsD5sRKF0
    &code_challenge_method=S256
    &scope=playlist-read-private+user-read-private...
```

The server:
1. Validates the `client_id` exists in the registered clients database
2. Validates the `redirect_uri` matches one of the registered URIs
3. Generates a session ID: `client_{client_id}_{state}`
4. Stores the pending OAuth request with session mapping
5. Shows the Spotify authorization page

### 3. User Authorization

User clicks "Authorize Spotify Access" and is redirected to Spotify's OAuth page with our pre-configured Spotify app credentials.

### 4. Callback & Redirect

After user authorizes on Spotify:
1. Spotify redirects to `/callback?code=SPOTIFY_CODE&state=...`
2. Server exchanges Spotify's code for tokens
3. Server stores tokens in database mapped to the session
4. Server checks for pending OAuth request
5. If found, **generates our own authorization code** (not Spotify's!)
6. Redirects to client's `redirect_uri` with **our authorization code**:
   ```
   302 Redirect
   Location: http://localhost:6274/oauth/callback/debug?code=OUR_AUTH_CODE&state=690cc4997039a644d346
   ```

**Important:** We generate our own authorization codes that map to sessions. This is crucial because:
- Spotify's auth code can only be used once (already exchanged in step 2)
- Our codes are stored in memory with client validation
- Codes expire in 10 minutes and are one-time use

### 5. Client Token Exchange

The client (MCP Inspector) receives our authorization code and exchanges it:

**Request:**
```bash
POST /token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=OUR_AUTH_CODE
&redirect_uri=http://localhost:6274/oauth/callback/debug
&client_id=mcp_f07904df1c74de5fead40e23ca27881d8c
&client_secret=CLIENT_SECRET
```

**Response:**
```json
{
  "access_token": "BQD7Kp...SPOTIFY_ACCESS_TOKEN",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "playlist-read-private user-read-private..."
}
```

The server:
1. Validates client credentials
2. Validates and consumes the authorization code (one-time use)
3. Finds the associated session
4. Returns the Spotify access token for that session

## Endpoints

### Dynamic Client Registration

#### `POST /register`
Register a new OAuth 2.0 client dynamically.

**Request Body:**
- `client_name` (optional): Human-readable client name
- `redirect_uris` (optional): Array of redirect URIs
- `grant_types` (optional): Supported grant types (default: `["authorization_code", "refresh_token"]`)
- `token_endpoint_auth_method` (optional): Auth method (default: `"client_secret_post"`)
- `scope` (optional): Requested scopes

**Response:** `201 Created` with client credentials

### Authorization Server Metadata

#### `GET /.well-known/oauth-authorization-server`
Returns OAuth 2.1 Authorization Server Metadata (RFC 8414) including:
```json
{
  "issuer": "https://splay.ngrok.dev",
  "authorization_endpoint": "https://splay.ngrok.dev/auth",
  "token_endpoint": "https://splay.ngrok.dev/token",
  "registration_endpoint": "https://splay.ngrok.dev/register",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "code_challenge_methods_supported": ["S256"],
  "scopes_supported": ["playlist-read-private", ...],
  "token_endpoint_auth_methods_supported": ["client_secret_post", "client_secret_basic"]
}
```

#### `GET /authorize`
Returns the same metadata for clients that don't support `.well-known` discovery.

### OAuth Authorization

#### `GET /auth`
Supports two modes:

**Mode 1: Legacy (sessionId)**
```
GET /auth?sessionId=<id>
```

**Mode 2: Standard OAuth 2.0 (registered clients)**
```
GET /auth?client_id=<id>&redirect_uri=<uri>&state=<state>&response_type=code&scope=<scopes>
```

#### `POST /token`
Exchange authorization code for access token (RFC 6749 Section 4.1.3).

**Client Authentication Methods:**

The server supports two standard OAuth 2.0 client authentication methods:

1. **HTTP Basic Authentication (RFC 6749 Section 2.3.1)** - Preferred method:
   ```bash
   POST /token
   Authorization: Basic <base64(client_id:client_secret)>
   Content-Type: application/x-www-form-urlencoded

   grant_type=authorization_code&code=...&redirect_uri=...
   ```

2. **Client Credentials in Body** - Alternative method:
   ```bash
   POST /token
   Content-Type: application/x-www-form-urlencoded

   grant_type=authorization_code&code=...&redirect_uri=...&client_id=...&client_secret=...
   ```

**Request Body (application/x-www-form-urlencoded):**
- `grant_type`: Must be `authorization_code`
- `code`: Authorization code from callback
- `redirect_uri`: Must match the registered redirect_uri
- `client_id`: Registered client ID (optional if using Basic Auth)
- `client_secret`: Client secret from registration (optional if using Basic Auth)

**Success Response (200 OK):**
```json
{
  "access_token": "BQD7Kp...SPOTIFY_ACCESS_TOKEN",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "playlist-read-private user-read-private..."
}
```

**Error Responses:**
- `400 invalid_request` - Missing required parameters
- `400 unsupported_grant_type` - Only authorization_code is supported
- `400 invalid_grant` - Code is invalid, expired, or already used
- `401 invalid_client` - Client authentication failed

**Notes:**
- Authorization codes are single-use and expire in 10 minutes
- The server returns Spotify's actual access token
- Token refresh is handled automatically by session management
- Client credentials can be sent via Authorization header (Basic Auth) or in POST body
- MCP Inspector uses HTTP Basic Auth by default

#### `GET /callback`
OAuth callback endpoint (Spotify redirects here after user authorization).

**Internal Flow:**
1. Receives Spotify authorization code
2. Exchanges it for Spotify access tokens
3. Stores tokens in session database
4. For registered clients: generates our own auth code
5. Redirects to client's registered redirect_uri

### MCP Connection

#### `GET /mcp` - Establish SSE Connection
Connect to the MCP server endpoint after obtaining authorization.

**Authentication Methods:**

1. **Bearer Token Authentication (RFC 6750)** - For registered OAuth clients:
   ```bash
   GET /mcp
   Authorization: Bearer BQD7Kp...SPOTIFY_ACCESS_TOKEN
   ```
   The server will:
   - Extract the Bearer token from the Authorization header
   - Search all sessions to find the matching access token
   - Identify the session associated with that token
   - Establish the SSE connection for that session

2. **Session ID Query Parameter** - For legacy clients:
   ```bash
   GET /mcp?sessionId=<session_id>
   ```

**Response:**
- `200 OK` with `Content-Type: text/event-stream` - SSE connection established
- `401 Unauthorized` with WWW-Authenticate header - Authentication required

**Access Token to Session Mapping:**

When a client connects with a Bearer token, the server:
1. Extracts the access token from the `Authorization: Bearer <token>` header
2. Iterates through all stored sessions
3. Compares the token with each session's stored access token
4. Uses the matching session for the MCP connection

This allows clients (like MCP Inspector) to:
- Use the access token received from `/token` endpoint
- Connect without knowing the internal session ID
- Follow standard OAuth 2.0 Bearer token authentication pattern

**Implementation Detail:**
```typescript
const authHeader = req.headers['authorization'];
if (authHeader && authHeader.startsWith('Bearer ')) {
  const accessToken = authHeader.substring(7);
  const allSessions = this.authManager.getAllSessions();

  for (const session of allSessions) {
    const sessionToken = await this.authManager.getAccessToken(session.sessionId);
    if (sessionToken === accessToken) {
      clientSessionId = session.sessionId;
      logger.info({ sessionId: clientSessionId }, 'Session identified from Bearer token');
      break;
    }
  }
}
```

## Database Schema

### `data/clients.db`

**Table: `registered_clients`**
```sql
CREATE TABLE registered_clients (
  client_id TEXT PRIMARY KEY,
  client_secret TEXT NOT NULL,
  client_name TEXT,
  redirect_uris TEXT NOT NULL,       -- JSON array
  grant_types TEXT NOT NULL,         -- JSON array
  response_types TEXT NOT NULL,      -- JSON array
  token_endpoint_auth_method TEXT NOT NULL,
  scope TEXT,
  created_at INTEGER NOT NULL,
  registration_access_token TEXT
)
```

## Testing with MCP Inspector

### Step 1: Start the Server
```bash
bun run dev:http
# or with Docker
./manage-docker.sh start
```

### Step 2: Configure MCP Inspector
1. **Transport Type**: SSE
2. **URL**: `https://splay.ngrok.dev/mcp` (or your ngrok URL)
3. **Connection Type**: Direct

### Step 3: Click "Guided OAuth Flow"

MCP Inspector will:
1. Fetch `/.well-known/oauth-authorization-server`
2. Discover the `/register` endpoint
3. POST to `/register` to create a new client
4. Open the authorization URL in your browser
5. After you authorize, complete the flow

## Backward Compatibility

The implementation maintains full backward compatibility with the existing session-based flow:

**Legacy Flow (still works):**
```bash
# Generate session ID
SESSION_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')

# Visit authorization page
open "http://localhost:3001/auth?sessionId=$SESSION_ID"

# After authorization, connect
curl "http://localhost:3001/mcp?sessionId=$SESSION_ID"
```

**New Flow (for registered clients):**
```bash
# Register client
CLIENT=$(curl -X POST http://localhost:3001/register \
  -H "Content-Type: application/json" \
  -d '{"client_name":"My App","redirect_uris":["http://localhost:3000/callback"]}')

# Extract client_id
CLIENT_ID=$(echo $CLIENT | jq -r .client_id)

# Initiate OAuth flow
open "http://localhost:3001/auth?client_id=$CLIENT_ID&redirect_uri=http://localhost:3000/callback&state=xyz&response_type=code"
```

## Security Considerations

1. **Authorization Code Security**:
   - One-time use (consumed immediately after exchange)
   - Short-lived (10-minute expiration)
   - Bound to specific client and redirect_uri
   - Cryptographically secure random generation (32 bytes)
   - Prevents replay attacks and unauthorized token access

2. **Client Secret Storage**: Client secrets are stored in plaintext in the database. For production, consider encryption.

3. **Redirect URI Validation**: The server strictly validates redirect URIs against registered URIs to prevent open redirects.

4. **State Parameter**: CSRF protection via state parameter is enforced throughout the OAuth flow.

5. **Client Authentication**: The `/token` endpoint validates both `client_id` and `client_secret` before issuing tokens.

6. **PKCE Support**: The server accepts `code_challenge` and `code_challenge_method` parameters (stored but not yet validated).

7. **CORS Configuration**: Wildcard CORS (`*`) is enabled for development. For production, restrict to specific origins.

8. **Token Expiration**:
   - Authorization codes: 10 minutes
   - Spotify access tokens: 1 hour (auto-refreshed)
   - Client secrets: Never expire (configurable)

## Implementation Details

### HTTP Basic Authentication Parsing

The `/token` endpoint supports HTTP Basic Authentication for client credentials (RFC 6749 Section 2.3.1):

```typescript
const authHeader = req.headers['authorization'];
if (authHeader && authHeader.startsWith('Basic ')) {
  const base64Credentials = authHeader.substring(6);
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [headerClientId, headerClientSecret] = credentials.split(':');
  clientId = headerClientId;
  clientSecret = headerClientSecret;
}
```

**How it works:**
1. Client encodes credentials as `base64(client_id:client_secret)`
2. Sends in header: `Authorization: Basic <base64_string>`
3. Server decodes the Base64 string
4. Splits on `:` to extract client_id and client_secret
5. Validates credentials against registered clients database

**Example:**
```bash
# Client credentials: mcp_abc123:secretXYZ
# Encoded: bWNwX2FiYzEyMzpzZWNyZXRYWVo=
curl -X POST http://localhost:3001/token \
  -H "Authorization: Basic bWNwX2FiYzEyMzpzZWNyZXRYWVo=" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code=...&redirect_uri=..."
```

The server prioritizes credentials from the Authorization header over body parameters, but accepts both for compatibility.

### Bearer Token to Session Mapping

When clients connect to the MCP endpoint with a Bearer token, the server must map the access token back to a session:

```typescript
// Extract Bearer token
const authHeader = req.headers['authorization'];
if (authHeader && authHeader.startsWith('Bearer ')) {
  const accessToken = authHeader.substring(7);

  // Find matching session
  const allSessions = this.authManager.getAllSessions();
  for (const session of allSessions) {
    const sessionToken = await this.authManager.getAccessToken(session.sessionId);
    if (sessionToken === accessToken) {
      clientSessionId = session.sessionId;
      break;
    }
  }
}
```

**Why this is necessary:**
- Clients receive an access token from the `/token` endpoint
- MCP connections require a session ID internally
- The server bridges these by searching for the token across all sessions
- This enables standard OAuth 2.0 Bearer token authentication

**Performance considerations:**
- The lookup iterates through all sessions (O(n) complexity)
- For production with many sessions, consider maintaining a reverse index (token → sessionId)
- Current implementation is suitable for development and small-scale deployments

**Important note:**
This is what prevents the "endless authorization loop" issue. Without this mapping, clients with valid tokens would be repeatedly redirected to the authorization endpoint.

### Session ID Generation

For registered clients, session IDs follow the pattern:
```
client_{client_id}_{state}
```

This ensures:
- Unique sessions per authorization request
- Traceable back to the registered client
- State parameter preserved for CSRF protection

### Pending OAuth Requests

The server maintains a map of pending OAuth requests:
```typescript
{
  sessionId: {
    clientId: string,
    redirectUri: string,
    state: string,
    responseType: string,
    scope: string,
    codeChallenge?: string,
    codeChallengeMethod?: string,
    expiresAt: number
  }
}
```

This allows the callback handler to:
1. Identify which client initiated the flow
2. Redirect back to the correct redirect_uri
3. Preserve the original state parameter
4. Clean up expired requests

### Authorization Code Management

The server maintains an in-memory map of authorization codes:
```typescript
{
  authCode: {
    sessionId: string,
    clientId: string,
    redirectUri: string,
    expiresAt: number
  }
}
```

**Key characteristics:**
- **One-time use**: Codes are deleted after successful exchange
- **Short-lived**: Expire in 10 minutes
- **Client-bound**: Validated against client_id and redirect_uri
- **Secure**: Generated with `crypto.randomBytes(32).toString('base64url')`

**Why separate codes?**
- Spotify's auth code is consumed immediately in `/callback`
- Our codes bridge the gap between Spotify tokens and client authorization
- Enables proper OAuth 2.0 flow with third-party clients (MCP Inspector)

### CORS Configuration

All endpoints have CORS enabled for cross-origin requests:
```typescript
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, OPTIONS, PUT, DELETE
Access-Control-Allow-Headers: Content-Type, Authorization, Mcp-Session-Id
Access-Control-Expose-Headers: WWW-Authenticate
```

This allows MCP Inspector (running on localhost) to communicate with the ngrok-hosted server.

## Future Enhancements

1. **PKCE Validation**: Validate `code_challenge` during token exchange (currently accepted but not validated).

2. **Refresh Token Support**: Expose refresh tokens to clients (currently handled internally).

3. **Client Management**: Add endpoints to update/delete registered clients:
   - `GET /register/{client_id}` - Retrieve client info
   - `PUT /register/{client_id}` - Update client metadata
   - `DELETE /register/{client_id}` - Delete client

4. **Encryption**: Encrypt client secrets and tokens at rest.

5. **Persistent Authorization Codes**: Store auth codes in database instead of memory for multi-instance deployments.

6. **Rate Limiting**: Add rate limiting to `/register` and `/token` endpoints.

## References

- [RFC 6749 - OAuth 2.0 Authorization Framework](https://datatracker.ietf.org/doc/html/rfc6749)
- [RFC 6750 - OAuth 2.0 Bearer Token Usage](https://datatracker.ietf.org/doc/html/rfc6750)
- [RFC 7591 - OAuth 2.0 Dynamic Client Registration Protocol](https://datatracker.ietf.org/doc/html/rfc7591)
- [RFC 7636 - Proof Key for Code Exchange (PKCE)](https://datatracker.ietf.org/doc/html/rfc7636)
- [RFC 8414 - OAuth 2.0 Authorization Server Metadata](https://datatracker.ietf.org/doc/html/rfc8414)
- [MCP Specification - Authorization](https://modelcontextprotocol.io/specification/draft/basic/authorization)
