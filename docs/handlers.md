## Programmatic API (Handlers)

ArtistLens exposes handler classes that map closely to Spotify endpoints. These can be used when embedding in Node.js alongside `AuthManager` and `SpotifyApi`.

### Setup

```ts
import { AuthManager } from '@thomaswawra/artistlens/build/utils/auth.js';
import { SpotifyApi } from '@thomaswawra/artistlens/build/utils/api.js';
import { ArtistsHandler } from '@thomaswawra/artistlens/build/handlers/artists.js';
import { AlbumsHandler } from '@thomaswawra/artistlens/build/handlers/albums.js';
import { TracksHandler } from '@thomaswawra/artistlens/build/handlers/tracks.js';
import { PlaylistsHandler } from '@thomaswawra/artistlens/build/handlers/playlists.js';
import { AudiobooksHandler } from '@thomaswawra/artistlens/build/handlers/audiobooks.js';
import { SearchHandler } from '@thomaswawra/artistlens/build/handlers/search.js';

const api = new SpotifyApi(new AuthManager());

const artists = new ArtistsHandler(api);
const albums = new AlbumsHandler(api);
const tracks = new TracksHandler(api);
const playlists = new PlaylistsHandler(api);
const audiobooks = new AudiobooksHandler(api);
const search = new SearchHandler(api);
```

### `ArtistsHandler`

- `getArtist(args: { id: string })`
- `getMultipleArtists(args: { ids: string[] })` (max 50)
- `getArtistTopTracks(args: { id: string; market: string })`
- `getArtistRelatedArtists(args: { id: string })`
- `getArtistAlbums(args: { id: string; include_groups?: string[]; limit?: number; offset?: number })`

Example:

```ts
const artist = await artists.getArtist({ id: '4tZwfgrHOc3mvqYlEYSvVi' });
```

### `AlbumsHandler`

- `getAlbum(args: { id: string })`
- `getMultipleAlbums(args: { ids: string[] })` (max 20)
- `getAlbumTracks(args: { id: string; limit?: number; offset?: number })`
- `getNewReleases(args: { country?: string; limit?: number; offset?: number })`

### `TracksHandler`

- `getTrack(args: { id: string })`
- `getRecommendations(args: { seed_tracks?: string[]; seed_artists?: string[]; seed_genres?: string[]; limit?: number })`
- `getAvailableGenres()`

### `PlaylistsHandler`

- `getPlaylist(args: { id: string; market?: string })`
- `getPlaylistTracks(args: { id: string; market?: string; fields?: string; limit?: number; offset?: number })`
- `getPlaylistItems(args: { id: string; market?: string; fields?: string; limit?: number; offset?: number })`
- `modifyPlaylist(args: { id: string; name?: string; public?: boolean; collaborative?: boolean; description?: string })`
- `addTracksToPlaylist(args: { id: string; uris: string[]; position?: number })`
- `removeTracksFromPlaylist(args: { id: string; tracks: { uri: string; positions?: number[] }[]; snapshot_id?: string })`
- `getCurrentUserPlaylists(args: { limit?: number; offset?: number })`
- `getFeaturedPlaylists(args: { locale?: string; limit?: number; offset?: number })`
- `getCategoryPlaylists(args: { category_id: string; limit?: number; offset?: number })`

Note: Playlist modification and current-user endpoints typically require a user-scoped OAuth token; with Client Credentials they may return authorization errors.

### `AudiobooksHandler`

- `getAudiobook(args: { id: string; market?: string })`
- `getMultipleAudiobooks(args: { ids: string[]; market?: string })` (max 50)
- `getAudiobookChapters(args: { id: string; market?: string; limit?: number; offset?: number })`

### `SearchHandler`

- `search(args: { query: string; type: 'track' | 'album' | 'artist' | 'playlist'; limit?: number })`

