import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { SearchHandler } from '../handlers/search.js';
import { SpotifyApi } from '../utils/api.js';

describe('SearchHandler', () => {
  let handler: SearchHandler;
  let mockApi: { makeRequest: ReturnType<typeof mock>; buildQueryString: ReturnType<typeof mock> };

  beforeEach(() => {
    mockApi = {
      makeRequest: mock(() => Promise.resolve({})),
      buildQueryString: mock(() => ''),
    };
    handler = new SearchHandler(mockApi as unknown as SpotifyApi);
  });

  describe('search', () => {
    it('should search for tracks', async () => {
      const mockResponse = { tracks: { items: [{ id: '123', name: 'Test Track' }] } };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      handler = new SearchHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.search({ query: 'test', type: 'track' });

      expect(result).toEqual(mockResponse);
    });

    it('should search for artists', async () => {
      const mockResponse = { artists: { items: [{ id: '123', name: 'Test Artist' }] } };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      handler = new SearchHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.search({ query: 'test', type: 'artist' });

      expect(result).toEqual(mockResponse);
    });

    it('should search for albums', async () => {
      const mockResponse = { albums: { items: [{ id: '123', name: 'Test Album' }] } };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      handler = new SearchHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.search({ query: 'test', type: 'album' });

      expect(result).toEqual(mockResponse);
    });

    it('should search for playlists', async () => {
      const mockResponse = { playlists: { items: [{ id: '123', name: 'Test Playlist' }] } };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      handler = new SearchHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.search({ query: 'test', type: 'playlist' });

      expect(result).toEqual(mockResponse);
    });

    it('should use default limit when not specified', async () => {
      const mockResponse = { tracks: { items: [] } };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      handler = new SearchHandler(mockApi as unknown as SpotifyApi);

      await handler.search({ query: 'test', type: 'track' });

      expect(mockApi.makeRequest).toHaveBeenCalled();
    });

    it('should respect custom limit', async () => {
      const mockResponse = { tracks: { items: [] } };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      handler = new SearchHandler(mockApi as unknown as SpotifyApi);

      await handler.search({ query: 'test', type: 'track', limit: 10 });

      expect(mockApi.makeRequest).toHaveBeenCalled();
    });
  });
});
