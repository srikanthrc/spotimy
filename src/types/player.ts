/**
 * Player/Playback control types for Spotify Web API
 * https://developer.spotify.com/documentation/web-api/reference/get-information-about-the-users-current-playback
 */

export interface GetPlaybackStateArgs {
  market?: string;
  additional_types?: string;  // 'track' | 'episode'
}

export interface TransferPlaybackArgs {
  device_ids: string[];
  play?: boolean;
}

export interface StartPlaybackArgs {
  device_id?: string;
  context_uri?: string;  // Album, artist, or playlist URI
  uris?: string[];  // Track URIs
  offset?: {
    position?: number;
    uri?: string;
  };
  position_ms?: number;
}

export interface PausePlaybackArgs {
  device_id?: string;
}

export interface SkipToNextArgs {
  device_id?: string;
}

export interface SkipToPreviousArgs {
  device_id?: string;
}

export interface SeekToPositionArgs {
  position_ms: number;
  device_id?: string;
}

export interface SetRepeatModeArgs {
  state: 'track' | 'context' | 'off';
  device_id?: string;
}

export interface SetVolumeArgs {
  volume_percent: number;
  device_id?: string;
}

export interface SetShuffleArgs {
  state: boolean;
  device_id?: string;
}

export interface GetRecentlyPlayedArgs {
  limit?: number;
  after?: number;
  before?: number;
}

export interface AddToQueueArgs {
  uri: string;
  device_id?: string;
}

// Response types
export interface Device {
  id: string | null;
  is_active: boolean;
  is_private_session: boolean;
  is_restricted: boolean;
  name: string;
  type: string;
  volume_percent: number | null;
  supports_volume: boolean;
}

export interface PlaybackState {
  device: Device;
  repeat_state: 'off' | 'track' | 'context';
  shuffle_state: boolean;
  context: {
    type: string;
    href: string;
    external_urls: { spotify: string };
    uri: string;
  } | null;
  timestamp: number;
  progress_ms: number | null;
  is_playing: boolean;
  item: Record<string, unknown> | null;  // Track or Episode object
  currently_playing_type: 'track' | 'episode' | 'ad' | 'unknown';
  actions: {
    interrupting_playback?: boolean;
    pausing?: boolean;
    resuming?: boolean;
    seeking?: boolean;
    skipping_next?: boolean;
    skipping_prev?: boolean;
    toggling_repeat_context?: boolean;
    toggling_shuffle?: boolean;
    toggling_repeat_track?: boolean;
    transferring_playback?: boolean;
  };
}

export interface PlayHistory {
  track: Record<string, unknown>;
  played_at: string;
  context: {
    type: string;
    href: string;
    external_urls: { spotify: string };
    uri: string;
  } | null;
}

export interface RecentlyPlayedResponse {
  href: string;
  limit: number;
  next: string | null;
  cursors: {
    after: string;
    before: string;
  };
  total: number;
  items: PlayHistory[];
}

export interface Queue {
  currently_playing: Record<string, unknown> | null;
  queue: Record<string, unknown>[];
}
