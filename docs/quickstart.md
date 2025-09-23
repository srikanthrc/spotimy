## Quickstart

### 1) Install

- **Via Smithery (Claude Desktop)**

```bash
npx -y @smithery/cli install @superseoworld/artistlens --client claude
```

- **Global install**

```bash
npm install -g @thomaswawra/artistlens
```

- **Run on demand**

```bash
npx -y @thomaswawra/artistlens
```

### 2) Configure credentials

You must provide Spotify API credentials.

```json
{
  "mcpServers": {
    "spotify": {
      "command": "npx",
      "args": ["-y", "@thomaswawra/artistlens"],
      "env": {
        "SPOTIFY_CLIENT_ID": "your_client_id",
        "SPOTIFY_CLIENT_SECRET": "your_client_secret"
      }
    }
  }
}
```

Get credentials from the Spotify Developer Dashboard.

### 3) Verify the server is running

Use your MCP client (e.g., Claude Desktop) to list available tools. You should see tools such as `search`, `get_artist`, `get_album`, etc.

### 4) First calls

- **Search artists**

```json
{
  "name": "search",
  "arguments": { "query": "daft punk", "type": "artist", "limit": 5 }
}
```

- **Get an artist**

```json
{
  "name": "get_artist",
  "arguments": { "id": "4tZwfgrHOc3mvqYlEYSvVi" }
}
```

### Notes on auth

- Client Credentials flow is used (no user context). This allows access to most catalog data.
- Endpoints that require a user context (e.g., modifying playlists, current-user playlists) may fail without extending auth to an Authorization Code flow.

