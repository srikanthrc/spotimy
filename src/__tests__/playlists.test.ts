import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { PlaylistsHandler } from '../handlers/playlists.js';
import { SpotifyApi } from '../utils/api.js';

describe('PlaylistsHandler', () => {
  let handler: PlaylistsHandler;
  let mockApi: { makeRequest: ReturnType<typeof mock>; buildQueryString: ReturnType<typeof mock> };

  beforeEach(() => {
    mockApi = {
      makeRequest: mock(() => Promise.resolve({})),
      buildQueryString: mock(() => ''),
    };
    handler = new PlaylistsHandler(mockApi as unknown as SpotifyApi);
  });

  describe('getPlaylist', () => {
    it('should fetch a playlist by ID', async () => {
      const mockResponse = { id: '123', name: 'Test Playlist' };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      handler = new PlaylistsHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.getPlaylist({ id: '123' });

      expect(result).toEqual(mockResponse);
    });

    it('should handle spotify:playlist: prefixed IDs', async () => {
      const mockResponse = { id: '123', name: 'Test Playlist' };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      handler = new PlaylistsHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.getPlaylist({ id: 'spotify:playlist:123' });

      expect(result).toEqual(mockResponse);
    });
  });

  describe('getPlaylistTracks', () => {
    it('should fetch playlist tracks', async () => {
      const mockResponse = { items: [{ track: { id: '123' } }] };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      mockApi.buildQueryString = mock(() => '?limit=100&offset=0');
      handler = new PlaylistsHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.getPlaylistTracks({ id: '123' });

      expect(result).toEqual(mockResponse);
    });
  });

  describe('getPlaylistItems', () => {
    it('should fetch playlist items', async () => {
      const mockResponse = { items: [{ track: { id: '123' } }] };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      mockApi.buildQueryString = mock(() => '?limit=100&offset=0');
      handler = new PlaylistsHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.getPlaylistItems({ id: '123' });

      expect(result).toEqual(mockResponse);
    });
  });

  describe('getCurrentUserPlaylists', () => {
    it('should fetch current user playlists', async () => {
      const mockResponse = { items: [{ id: '123', name: 'My Playlist' }] };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      mockApi.buildQueryString = mock(() => '?limit=20&offset=0');
      handler = new PlaylistsHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.getCurrentUserPlaylists({});

      expect(result).toEqual(mockResponse);
    });
  });

  describe('createPlaylist', () => {
    it('should create a playlist', async () => {
      const meResponse = { id: 'user123' };
      const playlistResponse = { id: 'playlist123', name: 'New Playlist' };
      let callCount = 0;
      mockApi.makeRequest = mock(() => {
        callCount++;
        if (callCount === 1) return Promise.resolve(meResponse);
        return Promise.resolve(playlistResponse);
      });
      handler = new PlaylistsHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.createPlaylist({ name: 'New Playlist' });

      expect(result).toEqual(playlistResponse);
    });
  });

});
