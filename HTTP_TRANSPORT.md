# MCP Streamable HTTP Transport

This ArtistLens MCP server now supports both traditional stdio transport and the new MCP Streamable HTTP transport.

## What is MCP Streamable HTTP Transport?

The Streamable HTTP transport is the latest MCP transport mechanism introduced in the 2025-03-26 specification. It replaces the HTTP+SSE transport with a more robust and flexible solution that:

- Uses a single endpoint for all MCP operations
- Supports Server-Sent Events (SSE) for real-time streaming
- Provides session management and connection recovery
- Enables multiple concurrent client connections
- Offers better scalability for remote MCP servers

## Usage

### Starting the HTTP Server

```bash
# Development mode
bun run dev:http

# Production mode (after building)
bun run mcp:http

# Custom port and host
bun src/http-server.ts --port=8080 --host=0.0.0.0
```

### Available Endpoints

- `GET /mcp` - Establishes SSE connection for MCP communication
- `POST /mcp?sessionId=<id>` - Sends MCP messages to the server
- `GET /health` - Health check endpoint

### Client Connection Process

1. **Health Check** (optional): `GET /health`
2. **Establish SSE**: `GET /mcp`
   - Server responds with `event: endpoint` containing the POST endpoint URL with session ID
3. **Send Messages**: `POST /mcp?sessionId=<session-id>`
   - Send JSON-RPC messages as HTTP POST requests
   - Receive responses via the SSE stream

### Example Client Usage

```javascript
import { EventSource } from 'eventsource';

// Step 1: Establish SSE connection
const eventSource = new EventSource('http://localhost:3001/mcp');

// Step 2: Wait for endpoint event
eventSource.addEventListener('endpoint', (event) => {
  const endpoint = 'http://localhost:3001' + decodeURI(event.data);

  // Step 3: Send MCP messages to the endpoint
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
});

// Step 4: Listen for responses
eventSource.addEventListener('message', (event) => {
  const response = JSON.parse(event.data);
  console.log('MCP Response:', response);
});
```

## Features

- **Session Management**: Each connection gets a unique session ID
- **CORS Support**: Configured for cross-origin requests
- **Error Handling**: Comprehensive error handling and logging
- **Graceful Shutdown**: Proper cleanup of connections and resources
- **Multiple Transports**: Run both stdio and HTTP transports simultaneously

## Testing

A test script is included to verify the HTTP transport functionality:

```bash
# Start the server
bun src/http-server.ts --port=3001 &

# Run the test
bun test-http-mcp.js
```

The test verifies:
- Health endpoint functionality
- SSE connection establishment
- MCP protocol initialization
- Tool listing capability
- Message round-trip communication

## Comparison with Stdio Transport

| Feature | Stdio Transport | HTTP Transport |
|---------|----------------|----------------|
| Multiple Clients | ❌ Single process | ✅ Multiple concurrent |
| Remote Access | ❌ Local only | ✅ Network accessible |
| Session Management | ❌ None | ✅ Session IDs |
| Scalability | ❌ Limited | ✅ Highly scalable |
| Development | ✅ Simple debugging | ⚠️ Requires HTTP client |
| Performance | ✅ Direct pipe | ⚠️ Network overhead |

## Migration Guide

### From Stdio to HTTP

If you're currently using the stdio transport, you can switch to HTTP transport:

**Before (stdio):**
```bash
bun src/index.ts
```

**After (HTTP):**
```bash
bun src/http-server.ts --port=3001
```

### Dual Transport Setup

You can run both transports simultaneously:

```bash
# Terminal 1: HTTP transport
bun src/http-server.ts --port=3001

# Terminal 2: Stdio transport
bun src/index.ts
```

This allows you to support both local stdio clients and remote HTTP clients at the same time.