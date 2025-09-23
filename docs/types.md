## Types

Below are the primary argument interfaces used across tools and handlers. They mirror the TypeScript interfaces in `src/types/`.

### Common

```ts
export interface PaginationParams { limit?: number; offset?: number }
export interface MarketParams { market?: string }
export interface TokenInfo { accessToken: string; expiresAt: number }
```

### Artists

```ts
export interface ArtistArgs { id: string }
export interface ArtistTopTracksArgs extends ArtistArgs, MarketParams {}
export interface ArtistRelatedArtistsArgs extends ArtistArgs {}
export interface ArtistAlbumsArgs extends ArtistArgs, PaginationParams {
  include_groups?: ('album' | 'single' | 'appears_on' | 'compilation')[]
}
export interface MultipleArtistsArgs { ids: string[] }
```

### Albums

```ts
export interface AlbumArgs { id: string }
export interface AlbumTracksArgs extends AlbumArgs, PaginationParams {}
export interface MultipleAlbumsArgs { ids: string[] }
export interface NewReleasesArgs extends PaginationParams { country?: string }
```

### Tracks & Recommendations

```ts
export interface TrackArgs { id: string }
export interface RecommendationsArgs {
  seed_tracks?: string[]
  seed_artists?: string[]
  seed_genres?: string[]
  limit?: number
}
export interface GenreSeedsResponse { genres: string[] }
```

### Audiobooks

```ts
export interface AudiobookArgs extends MarketParams { id: string }
export interface MultipleAudiobooksArgs extends MarketParams { ids: string[] }
export interface AudiobookChaptersArgs extends MarketParams {
  id: string
  limit?: number
  offset?: number
}
```

### Playlists

```ts
export interface PlaylistArgs extends MarketParams { id: string }
export interface PlaylistTracksArgs extends MarketParams, PaginationParams {
  id: string
  fields?: string
}
export interface PlaylistItemsArgs extends MarketParams, PaginationParams {
  id: string
  fields?: string
}
export interface ModifyPlaylistArgs {
  id: string
  name?: string
  public?: boolean
  collaborative?: boolean
  description?: string
}
export interface AddTracksToPlaylistArgs {
  id: string
  uris: string[]
  position?: number
}
export interface RemoveTracksFromPlaylistArgs {
  id: string
  tracks: Array<{ uri: string; positions?: number[] }>
  snapshot_id?: string
}
export interface GetCurrentUserPlaylistsArgs extends PaginationParams {
  limit?: number
  offset?: number
}
export interface GetFeaturedPlaylistsArgs { locale?: string; limit?: number; offset?: number }
export interface GetCategoryPlaylistsArgs { category_id: string; limit?: number; offset?: number }
```

### Search

```ts
export interface SearchArgs {
  query: string
  type: 'track' | 'album' | 'artist' | 'playlist'
  limit?: number
}
```

