## Examples & Recipes

### Get an artist and related artists

```json
{ "name": "get_artist", "arguments": { "id": "4tZwfgrHOc3mvqYlEYSvVi" } }
```

Then:

```json
{ "name": "get_artist_related_artists", "arguments": { "id": "4tZwfgrHOc3mvqYlEYSvVi" } }
```

### Top tracks in a market

```json
{ "name": "get_artist_top_tracks", "arguments": { "id": "4tZwfgrHOc3mvqYlEYSvVi", "market": "US" } }
```

### Search playlists and inspect items

```json
{ "name": "search", "arguments": { "query": "focus", "type": "playlist", "limit": 5 } }
```

Pick a playlist ID or URI and fetch items:

```json
{ "name": "get_playlist_items", "arguments": { "id": "37i9dQZF1DX3PFzdbtx1Us", "limit": 50 } }
```

### Get album tracks with pagination

```json
{ "name": "get_album_tracks", "arguments": { "id": "4aawyAB9vmqN3uQ7FjRGTy", "limit": 10, "offset": 0 } }
```

### Recommendations from seed genres

```json
{ "name": "get_available_genres", "arguments": {} }
```

Select a few genres and request recommendations:

```json
{ "name": "get_recommendations", "arguments": { "seed_genres": ["house", "electronic"], "limit": 20 } }
```

### Programmatic usage (Node.js)

```ts
import { AuthManager } from '@thomaswawra/artistlens/build/utils/auth.js';
import { SpotifyApi } from '@thomaswawra/artistlens/build/utils/api.js';
import { SearchHandler } from '@thomaswawra/artistlens/build/handlers/search.js';

const api = new SpotifyApi(new AuthManager());
const search = new SearchHandler(api);

const results = await search.search({ query: 'daft punk', type: 'artist', limit: 5 });
console.log(results);
```

