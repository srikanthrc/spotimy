# Testing Authorization Discovery with MCP Inspector

## Prerequisites
- Docker containers running (`docker compose up -d`)
- MCP Inspector open in browser
- Ngrok tunnel active: `https://splay.ngrok.dev`

---

## Test 1: Authorization Discovery Flow (401 Response)

### Goal
Verify that unauthenticated requests return proper 401 with discovery headers

### Steps

1. **Open MCP Inspector** in your browser

2. **Configure Connection:**
   - **Transport Type**: `SSE`
   - **URL**: `https://splay.ngrok.dev/mcp`
   - **Connection Type**: `Direct`
   - Leave Authentication section empty/collapsed

3. **Click "Connect"**

4. **Expected Result:**
   - ❌ Connection fails with error message
   - Error should say "Connection Error - Check if your MCP server is running and proxy token is correct"

5. **Verify Discovery Headers:**
   - Open browser DevTools (F12)
   - Go to **Network** tab
   - Find the GET request to `/mcp`
   - Click on it to see details
   - Check **Response Headers**:
     ```
     WWW-Authenticate: Bearer realm="https://splay.ngrok.dev", resource_metadata="https://splay.ngrok.dev/mcp-metadata"
     ```
   - Check **Response** body:
     ```json
     {
       "error": "unauthorized",
       "error_description": "Authentication required. Please obtain authorization.",
       "authorization_endpoint": "https://splay.ngrok.dev/auth",
       "resource_metadata": "https://splay.ngrok.dev/mcp-metadata"
     }
     ```

6. **✅ Test Passed if:**
   - HTTP status is 401
   - WWW-Authenticate header present
   - Response includes authorization_endpoint
   - Response includes resource_metadata

---

## Test 2: Resource Metadata Discovery

### Goal
Verify client can discover authorization endpoints

### Steps

1. **Open a new browser tab**

2. **Navigate to**: `https://splay.ngrok.dev/mcp-metadata`

3. **Expected Result:**
   ```json
   {
     "authorizationEndpoint": "https://splay.ngrok.dev/authorize",
     "tokenEndpoint": "https://splay.ngrok.dev/token",
     "resourceServer": "https://splay.ngrok.dev",
     "mcpEndpoint": "https://splay.ngrok.dev/mcp",
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

4. **✅ Test Passed if:**
   - All endpoints are present
   - URLs use the correct domain (splay.ngrok.dev)

---

## Test 3: Authorization Server Metadata

### Goal
Verify OAuth 2.1 metadata is available

### Steps

1. **Navigate to**: `https://splay.ngrok.dev/authorize`

2. **Expected Result:**
   ```json
   {
     "issuer": "https://splay.ngrok.dev",
     "authorization_endpoint": "https://splay.ngrok.dev/auth",
     "token_endpoint": "https://splay.ngrok.dev/token",
     "response_types_supported": ["code"],
     "grant_types_supported": ["authorization_code", "refresh_token"],
     "code_challenge_methods_supported": ["S256"],
     "scopes_supported": [...],
     "token_endpoint_auth_methods_supported": ["client_secret_post", "client_secret_basic"]
   }
   ```

3. **✅ Test Passed if:**
   - OAuth 2.1 metadata is complete
   - PKCE support is advertised (S256)

---

## Test 4: Complete Authorization Flow

### Goal
Successfully connect to MCP server after authorization

### Steps

#### Step 4.1: Generate Session ID

Run in terminal:
```bash
SESSION_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')
echo "Your Session ID: $SESSION_ID"
echo "Copy this for the next steps!"
```

Save the session ID - you'll need it!

#### Step 4.2: Authorize the Session

1. **Open in browser**: `https://splay.ngrok.dev/auth?sessionId=YOUR_SESSION_ID`
   (Replace YOUR_SESSION_ID with the ID from step 4.1)

2. **Click** "Authorize with Spotify" button

3. **Log in** to Spotify if prompted

4. **Authorize** the application

5. **Wait** for success page showing:
   - ✅ Authorization Successful!
   - Session ID (truncated)
   - Expiration time

#### Step 4.3: Connect with MCP Inspector

1. **Return to MCP Inspector**

2. **Update Configuration:**
   - **Transport Type**: `SSE`
   - **URL**: `https://splay.ngrok.dev/mcp?sessionId=YOUR_SESSION_ID`
   - **Connection Type**: `Direct`

3. **Click "Connect"**

4. **Expected Result:**
   - ✅ Connection succeeds!
   - Server info appears in the inspector
   - Tools list populates in the History section

#### Step 4.4: Test Tool Calls

1. **In MCP Inspector, try calling tools:**
   - Click on `tools/list` in History
   - You should see all available Spotify tools

2. **Call a tool:**
   - Use `get_session_info` tool (no parameters needed)
   - Should return your session details and auth status

3. **Try a Spotify API tool:**
   - Use `search` tool with:
     ```json
     {
       "query": "Taylor Swift",
       "type": "artist",
       "limit": 5
     }
     ```
   - Should return Spotify search results

4. **✅ Test Passed if:**
   - Tools are listed successfully
   - Tool calls return valid data
   - No authentication errors

---

## Test 5: Invalid/Expired Session

### Goal
Verify proper error handling for invalid sessions

### Steps

1. **In MCP Inspector, update URL:**
   - **URL**: `https://splay.ngrok.dev/mcp?sessionId=invalid-session-12345`

2. **Click "Connect"**

3. **Expected Result:**
   - Connection fails
   - Check DevTools Network tab
   - Response should be 401 with:
     ```json
     {
       "error": "invalid_token",
       "error_description": "Session token is invalid or expired. Please re-authorize.",
       "authorization_endpoint": "https://splay.ngrok.dev/auth?sessionId=invalid-session-12345",
       "session_id": "invalid-session-12345"
     }
     ```

4. **✅ Test Passed if:**
   - Returns 401 with error="invalid_token"
   - Provides re-authorization endpoint

---

## Quick Reference Commands

### Check Server Health
```bash
curl https://splay.ngrok.dev/health | jq
```

### Check Session Status
```bash
curl "https://splay.ngrok.dev/health?sessionId=YOUR_SESSION_ID" | jq '.auth'
```

### View Server Logs
```bash
docker compose logs -f spotimy-mcp
```

### Generate New Session
```bash
uuidgen | tr '[:upper:]' '[:lower:]'
```

---

## Troubleshooting

### Connection fails even after authorization

**Check:**
1. Session ID matches exactly (no extra spaces)
2. Authorization completed successfully
3. Token hasn't expired (check `/health?sessionId=...`)

**Fix:**
```bash
# Re-authorize the session
open "https://splay.ngrok.dev/auth?sessionId=YOUR_SESSION_ID"
```

### Can't see response headers in DevTools

**Solution:**
1. Open DevTools before clicking Connect
2. Go to Network tab
3. Check "Preserve log"
4. Try connection again

### Server not responding

**Check:**
```bash
# Verify containers are running
docker compose ps

# Check server logs
docker compose logs spotimy-mcp --tail 50
```

---

## Complete Test Checklist

- [ ] Test 1: Unauthenticated request returns 401 ✓
- [ ] Test 2: Resource metadata accessible ✓
- [ ] Test 3: Authorization server metadata available ✓
- [ ] Test 4.1: Session ID generated ✓
- [ ] Test 4.2: Authorization completed successfully ✓
- [ ] Test 4.3: MCP Inspector connects with auth ✓
- [ ] Test 4.4: Tool calls work correctly ✓
- [ ] Test 5: Invalid session properly rejected ✓

---

## Success Criteria

✅ **Authorization Discovery is working if:**
- Unauthenticated requests return 401 with WWW-Authenticate header
- Resource metadata endpoint is accessible
- Authorization server metadata follows OAuth 2.1 spec
- After authorization, MCP connection succeeds
- Tools can be called successfully
- Invalid sessions are properly rejected

🎉 **All tests passing = Full MCP Spec Compliance!**

