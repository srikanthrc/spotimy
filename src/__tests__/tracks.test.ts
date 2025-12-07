import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { TracksHandler } from '../handlers/tracks.js';
import { SpotifyApi } from '../utils/api.js';

describe('TracksHandler', () => {
  let handler: TracksHandler;
  let mockApi: { makeRequest: ReturnType<typeof mock>; buildQueryString: ReturnType<typeof mock> };

  beforeEach(() => {
    mockApi = {
      makeRequest: mock(() => Promise.resolve({})),
      buildQueryString: mock(() => ''),
    };
    handler = new TracksHandler(mockApi as unknown as SpotifyApi);
  });

  describe('getTrack', () => {
    it('should fetch a track by ID', async () => {
      const mockResponse = { id: '123', name: 'Test Track' };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      handler = new TracksHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.getTrack({ id: '123' });

      expect(mockApi.makeRequest).toHaveBeenCalledWith('/tracks/123');
      expect(result).toEqual(mockResponse);
    });

    it('should handle spotify:track: prefixed IDs', async () => {
      const mockResponse = { id: '123', name: 'Test Track' };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      handler = new TracksHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.getTrack({ id: 'spotify:track:123' });

      expect(mockApi.makeRequest).toHaveBeenCalledWith('/tracks/123');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getRecommendations', () => {
    it('should fetch recommendations with seed artists', async () => {
      const mockResponse = { tracks: [{ id: '123' }], seeds: [] };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      mockApi.buildQueryString = mock(() => '?seed_artists=123&limit=20');
      handler = new TracksHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.getRecommendations({ seed_artists: ['123'] });

      expect(result).toEqual(mockResponse);
    });
  });

  describe('getAvailableGenres', () => {
    it('should fetch available genres', async () => {
      const mockResponse = { genres: ['rock', 'pop', 'jazz'] };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      handler = new TracksHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.getAvailableGenres();

      expect(mockApi.makeRequest).toHaveBeenCalledWith('/recommendations/available-genre-seeds');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getUserTopTracks', () => {
    it('should fetch user top tracks', async () => {
      const mockResponse = { items: [{ id: '123' }] };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      mockApi.buildQueryString = mock(() => '?time_range=medium_term&limit=20&offset=0');
      handler = new TracksHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.getUserTopTracks({});

      expect(result).toEqual(mockResponse);
    });
  });
});
