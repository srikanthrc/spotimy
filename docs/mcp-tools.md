## MCP Tools Reference

Each tool is invoked by your MCP client by name with `arguments`. Below are input shapes and examples. Unless stated, all IDs accept either a plain Spotify ID or a full URI (e.g., `spotify:artist:...`).

### Auth

- **get_access_token** — Get a valid Spotify access token.
  - Input: `{}`
  - Example:
    ```json
    { "name": "get_access_token", "arguments": {} }
    ```

### Search

- **search** — Search for tracks, albums, artists, or playlists.
  - Input:
    ```json
    { "query": "string", "type": "track|album|artist|playlist", "limit?": 1-50 }
    ```
  - Example:
    ```json
    { "name": "search", "arguments": { "query": "daft punk", "type": "artist", "limit": 5 } }
    ```

### Artists

- **get_artist** — Get artist by ID.
  - `{ "id": "string" }`
- **get_multiple_artists** — Get multiple artists (max 50).
  - `{ "ids": ["string", ...] }`
- **get_artist_top_tracks** — Artist top tracks (requires `market`).
  - `{ "id": "string", "market": "ISO 3166-1 alpha-2" }`
- **get_artist_related_artists** — Similar artists.
  - `{ "id": "string" }`
- **get_artist_albums** — Artist albums with pagination and filters.
  - `{ "id": "string", "include_groups?": ["album"|"single"|"appears_on"|"compilation"], "limit?": 1-50, "offset?": >=0 }`

Examples:
```json
{ "name": "get_artist", "arguments": { "id": "4tZwfgrHOc3mvqYlEYSvVi" } }
{ "name": "get_artist_top_tracks", "arguments": { "id": "4tZwfgrHOc3mvqYlEYSvVi", "market": "US" } }
```

### Albums

- **get_album** — Album by ID.
  - `{ "id": "string" }`
- **get_album_tracks** — Album tracks with pagination.
  - `{ "id": "string", "limit?": 1-50, "offset?": >=0 }`
- **get_multiple_albums** — Multiple albums (max 20).
  - `{ "ids": ["string", ...] }`
- **get_new_releases** — Featured new releases with pagination.
  - `{ "country?": "ISO code", "limit?": 1-50, "offset?": >=0 }`

### Tracks & Recommendations

- **get_track** — Track by ID.
  - `{ "id": "string" }`
- **get_available_genres** — Genre seeds for recommendations.
  - `{}`
- **get_recommendations** — Based on seed tracks, artists, or genres (at least one seed required).
  - `{ "seed_tracks?": ["id|uri"], "seed_artists?": ["id|uri"], "seed_genres?": ["string"], "limit?": 1-100 }`

Example:
```json
{ "name": "get_recommendations", "arguments": { "seed_genres": ["house", "electronic"], "limit": 10 } }
```

### Audiobooks

- **get_audiobook** — Audiobook by ID (optional `market`).
  - `{ "id": "string", "market?": "ISO code" }`
- **get_multiple_audiobooks** — Multiple audiobooks (max 50; optional `market`).
  - `{ "ids": ["string", ...], "market?": "ISO code" }`
- **get_audiobook_chapters** — Chapters with pagination and optional `market`.
  - `{ "id": "string", "market?": "ISO code", "limit?": 1-50, "offset?": >=0 }`

### Playlists

- **get_playlist** — Playlist by ID (optional `market`).
  - `{ "id": "string", "market?": "ISO code" }`
- **get_playlist_tracks** — Playlist tracks with pagination, optional fields.
  - `{ "id": "string", "market?": "ISO code", "fields?": "string", "limit?": 1-100, "offset?": >=0 }`
- **get_playlist_items** — Playlist items (same input as tracks variant).
  - `{ "id": "string", "market?": "ISO code", "fields?": "string", "limit?": 1-100, "offset?": >=0 }`
- **modify_playlist** — Update playlist details (name, description, public, collaborative).
  - `{ "id": "string", "name?": "string", "public?": boolean, "collaborative?": boolean, "description?": "string" }`
- **add_tracks_to_playlist** — Add tracks by URI with optional position.
  - `{ "id": "string", "uris": ["spotify:track:...", ...], "position?": number }`
- **remove_tracks_from_playlist** — Remove by URI with optional positions and snapshot id.
  - `{ "id": "string", "tracks": [{ "uri": "spotify:track:...", "positions?": [number, ...] }], "snapshot_id?": "string" }`
- **get_current_user_playlists** — Current user playlists with pagination.
  - `{ "limit?": 1-50, "offset?": >=0 }`
- **get_featured_playlists** — Featured playlists with optional locale and pagination.
  - `{ "locale?": "es_MX", "limit?": 1-50, "offset?": >=0 }`
- **get_category_playlists** — Category playlists with pagination.
  - `{ "category_id": "string", "limit?": 1-50, "offset?": >=0 }`

### Notes

- For endpoints that typically require a user-scoped OAuth token (modify playlist, current-user playlists), using Client Credentials may result in authorization errors in production environments.
- The server accepts Spotify URIs (e.g., `spotify:track:...`) or raw IDs; URIs are normalized internally.

