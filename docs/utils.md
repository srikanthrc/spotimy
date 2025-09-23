## Utilities

### `AuthManager`

- **Purpose**: Obtains and caches a Spotify access token using the Client Credentials flow.
- **Env vars**: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` (required at process start).
- **Public methods**:
  - `getAccessToken(): Promise<string>`
    - Returns a valid access token, refreshing when expired.

### `SpotifyApi`

- **Purpose**: Thin wrapper around Axios for Spotify Web API calls.
- **Constants**:
  - `BASE_URL = https://api.spotify.com/v1`
- **Constructor**:
  - `new SpotifyApi(authManager: AuthManager)`
- **Public methods**:
  - `makeRequest<T>(path: string, method?: 'GET' | 'POST' | 'PUT' | 'DELETE', data?: any): Promise<T>`
    - Adds `Authorization: Bearer <token>` header via `AuthManager` and returns `response.data`.
    - Throws a structured MCP error on Spotify errors.
  - `buildQueryString(params: Record<string, string | number | boolean | undefined>): string`
    - Returns a prefixed query string like `?limit=20&offset=0` skipping undefined values.

### Error handling

- Errors from Spotify are propagated as MCP errors with `InternalError` and the Spotify message when available.
- Missing env vars at startup will throw an error before the server runs.

### Programmatic usage example

```ts
import { AuthManager } from '@thomaswawra/artistlens/build/utils/auth.js';
import { SpotifyApi } from '@thomaswawra/artistlens/build/utils/api.js';

const auth = new AuthManager();
const api = new SpotifyApi(auth);

const album = await api.makeRequest(`/albums/4aawyAB9vmqN3uQ7FjRGTy`);
console.log(album.name);
```

Note: The published package exposes compiled files under `build/`.

