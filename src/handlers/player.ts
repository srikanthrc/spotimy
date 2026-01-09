import { SpotifyApi } from '../utils/api.js';
import {
  GetPlaybackStateArgs,
  TransferPlaybackArgs,
  StartPlaybackArgs,
  PausePlaybackArgs,
  SkipToNextArgs,
  SkipToPreviousArgs,
  SeekToPositionArgs,
  SetRepeatModeArgs,
  SetVolumeArgs,
  SetShuffleArgs,
  GetRecentlyPlayedArgs,
  AddToQueueArgs,
} from '../types/player.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

/**
 * Handler for Spotify Player/Playback control endpoints
 * https://developer.spotify.com/documentation/web-api/reference/get-information-about-the-users-current-playback
 */
export class PlayerHandler {
  constructor(private api: SpotifyApi) {}

  /**
   * Get information about the user's current playback state
   */
  async getPlaybackState(args: GetPlaybackStateArgs = {}) {
    const params: Record<string, string | undefined> = {};
    if (args.market) params.market = args.market;
    if (args.additional_types) params.additional_types = args.additional_types;
    
    const result = await this.api.makeRequest(`/me/player${this.api.buildQueryString(params)}`);
    
    // API returns 204 (empty) when no active device
    if (!result) {
      return { message: 'No active playback device found' };
    }
    return result;
  }

  /**
   * Get the user's available devices
   */
  async getAvailableDevices() {
    return this.api.makeRequest('/me/player/devices');
  }

  /**
   * Get the currently playing track
   */
  async getCurrentlyPlayingTrack(args: GetPlaybackStateArgs = {}) {
    const params: Record<string, string | undefined> = {};
    if (args.market) params.market = args.market;
    if (args.additional_types) params.additional_types = args.additional_types;
    
    const result = await this.api.makeRequest(`/me/player/currently-playing${this.api.buildQueryString(params)}`);
    
    if (!result) {
      return { message: 'Nothing currently playing' };
    }
    return result;
  }

  /**
   * Transfer playback to a new device
   */
  async transferPlayback(args: TransferPlaybackArgs) {
    if (!args.device_ids || args.device_ids.length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'At least one device_id is required');
    }

    await this.api.makeRequest('/me/player', 'PUT', {
      device_ids: args.device_ids,
      play: args.play ?? false
    });
    
    return { success: true, message: 'Playback transferred' };
  }

  /**
   * Start/Resume playback
   */
  async startPlayback(args: StartPlaybackArgs = {}) {
    const queryParams: Record<string, string | undefined> = {};
    if (args.device_id) queryParams.device_id = args.device_id;

    const body: Record<string, unknown> = {};
    if (args.context_uri) body.context_uri = args.context_uri;
    if (args.uris) body.uris = args.uris;
    if (args.offset) body.offset = args.offset;
    if (args.position_ms !== undefined) body.position_ms = args.position_ms;

    const data = Object.keys(body).length > 0 ? body : undefined;
    await this.api.makeRequest(`/me/player/play${this.api.buildQueryString(queryParams)}`, 'PUT', data);
    
    return { success: true, message: 'Playback started' };
  }

  /**
   * Pause playback
   */
  async pausePlayback(args: PausePlaybackArgs = {}) {
    const queryParams: Record<string, string | undefined> = {};
    if (args.device_id) queryParams.device_id = args.device_id;

    await this.api.makeRequest(`/me/player/pause${this.api.buildQueryString(queryParams)}`, 'PUT');
    
    return { success: true, message: 'Playback paused' };
  }

  /**
   * Skip to next track
   */
  async skipToNext(args: SkipToNextArgs = {}) {
    const queryParams: Record<string, string | undefined> = {};
    if (args.device_id) queryParams.device_id = args.device_id;

    await this.api.makeRequest(`/me/player/next${this.api.buildQueryString(queryParams)}`, 'POST');
    
    return { success: true, message: 'Skipped to next track' };
  }

  /**
   * Skip to previous track
   */
  async skipToPrevious(args: SkipToPreviousArgs = {}) {
    const queryParams: Record<string, string | undefined> = {};
    if (args.device_id) queryParams.device_id = args.device_id;

    await this.api.makeRequest(`/me/player/previous${this.api.buildQueryString(queryParams)}`, 'POST');
    
    return { success: true, message: 'Skipped to previous track' };
  }

  /**
   * Seek to a position in the currently playing track
   */
  async seekToPosition(args: SeekToPositionArgs) {
    if (args.position_ms < 0) {
      throw new McpError(ErrorCode.InvalidParams, 'position_ms must be non-negative');
    }

    const queryParams: Record<string, string | number | undefined> = {
      position_ms: args.position_ms
    };
    if (args.device_id) queryParams.device_id = args.device_id;

    await this.api.makeRequest(`/me/player/seek${this.api.buildQueryString(queryParams)}`, 'PUT');
    
    return { success: true, message: `Seeked to position ${args.position_ms}ms` };
  }

  /**
   * Set repeat mode
   */
  async setRepeatMode(args: SetRepeatModeArgs) {
    const validStates = ['track', 'context', 'off'];
    if (!validStates.includes(args.state)) {
      throw new McpError(ErrorCode.InvalidParams, `state must be one of: ${validStates.join(', ')}`);
    }

    const queryParams: Record<string, string | undefined> = {
      state: args.state
    };
    if (args.device_id) queryParams.device_id = args.device_id;

    await this.api.makeRequest(`/me/player/repeat${this.api.buildQueryString(queryParams)}`, 'PUT');
    
    return { success: true, message: `Repeat mode set to ${args.state}` };
  }

  /**
   * Set playback volume
   */
  async setVolume(args: SetVolumeArgs) {
    if (args.volume_percent < 0 || args.volume_percent > 100) {
      throw new McpError(ErrorCode.InvalidParams, 'volume_percent must be between 0 and 100');
    }

    const queryParams: Record<string, string | number | undefined> = {
      volume_percent: args.volume_percent
    };
    if (args.device_id) queryParams.device_id = args.device_id;

    await this.api.makeRequest(`/me/player/volume${this.api.buildQueryString(queryParams)}`, 'PUT');
    
    return { success: true, message: `Volume set to ${args.volume_percent}%` };
  }

  /**
   * Toggle shuffle mode
   */
  async setShuffle(args: SetShuffleArgs) {
    const queryParams: Record<string, string | boolean | undefined> = {
      state: args.state
    };
    if (args.device_id) queryParams.device_id = args.device_id;

    await this.api.makeRequest(`/me/player/shuffle${this.api.buildQueryString(queryParams)}`, 'PUT');
    
    return { success: true, message: `Shuffle ${args.state ? 'enabled' : 'disabled'}` };
  }

  /**
   * Get recently played tracks
   */
  async getRecentlyPlayed(args: GetRecentlyPlayedArgs = {}) {
    const { limit = 20 } = args;
    
    if (limit < 1 || limit > 50) {
      throw new McpError(ErrorCode.InvalidParams, 'limit must be between 1 and 50');
    }

    const params: Record<string, number | undefined> = { limit };
    if (args.after) params.after = args.after;
    if (args.before) params.before = args.before;

    return this.api.makeRequest(`/me/player/recently-played${this.api.buildQueryString(params)}`);
  }

  /**
   * Get the user's playback queue
   */
  async getQueue() {
    return this.api.makeRequest('/me/player/queue');
  }

  /**
   * Add an item to the playback queue
   */
  async addToQueue(args: AddToQueueArgs) {
    if (!args.uri) {
      throw new McpError(ErrorCode.InvalidParams, 'uri is required');
    }

    // Validate URI format
    if (!args.uri.startsWith('spotify:track:') && !args.uri.startsWith('spotify:episode:')) {
      throw new McpError(ErrorCode.InvalidParams, 'uri must be a Spotify track or episode URI');
    }

    const queryParams: Record<string, string | undefined> = {
      uri: args.uri
    };
    if (args.device_id) queryParams.device_id = args.device_id;

    await this.api.makeRequest(`/me/player/queue${this.api.buildQueryString(queryParams)}`, 'POST');
    
    return { success: true, message: `Added ${args.uri} to queue` };
  }
}
