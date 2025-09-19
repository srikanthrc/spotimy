export interface TrackArgs {
  id: string;
}

export interface RecommendationsArgs {
  seed_tracks?: string[];
  seed_artists?: string[];
  seed_genres?: string[];
  limit?: number;
}

export interface GenreSeedsResponse {
  genres: string[];
}

export interface UserTopTracksArgs {
  time_range?: 'short_term' | 'medium_term' | 'long_term';
  limit?: number;
  offset?: number;
}
