import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { ArtistsHandler } from '../handlers/artists.js';
import { SpotifyApi } from '../utils/api.js';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

describe('ArtistsHandler', () => {
  let handler: ArtistsHandler;
  let mockApi: { makeRequest: ReturnType<typeof mock>; buildQueryString: ReturnType<typeof mock> };

  beforeEach(() => {
    mockApi = {
      makeRequest: mock(() => Promise.resolve({})),
      buildQueryString: mock(() => ''),
    };
    handler = new ArtistsHandler(mockApi as unknown as SpotifyApi);
  });

  describe('getArtist', () => {
    it('should fetch an artist by ID', async () => {
      const mockResponse = { id: '123', name: 'Test Artist' };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      handler = new ArtistsHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.getArtist({ id: '123' });

      expect(mockApi.makeRequest).toHaveBeenCalledWith('/artists/123');
      expect(result).toEqual(mockResponse);
    });

    it('should handle spotify:artist: prefixed IDs', async () => {
      const mockResponse = { id: '123', name: 'Test Artist' };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      handler = new ArtistsHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.getArtist({ id: 'spotify:artist:123' });

      expect(mockApi.makeRequest).toHaveBeenCalledWith('/artists/123');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getMultipleArtists', () => {
    it('should fetch multiple artists by IDs', async () => {
      const mockResponse = { artists: [{ id: '123' }, { id: '456' }] };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      handler = new ArtistsHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.getMultipleArtists({ ids: ['123', '456'] });

      expect(mockApi.makeRequest).toHaveBeenCalledWith('/artists?ids=123,456');
      expect(result).toEqual(mockResponse);
    });

    it('should throw error when no IDs provided', async () => {
      await expect(handler.getMultipleArtists({ ids: [] })).rejects.toThrow();
    });

    it('should throw error when too many IDs provided', async () => {
      const ids = Array(51).fill('123');
      await expect(handler.getMultipleArtists({ ids })).rejects.toThrow();
    });
  });

  describe('getArtistTopTracks', () => {
    it('should fetch artist top tracks with market', async () => {
      const mockResponse = { tracks: [{ id: '123' }, { id: '456' }] };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      handler = new ArtistsHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.getArtistTopTracks({ id: '123', market: 'US' });

      expect(mockApi.makeRequest).toHaveBeenCalledWith('/artists/123/top-tracks?market=US');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getArtistRelatedArtists', () => {
    it('should fetch artist related artists', async () => {
      const mockResponse = { artists: [{ id: '123' }, { id: '456' }] };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      handler = new ArtistsHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.getArtistRelatedArtists({ id: '123' });

      expect(mockApi.makeRequest).toHaveBeenCalledWith('/artists/123/related-artists');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getArtistAlbums', () => {
    it('should fetch artist albums with default parameters', async () => {
      const mockResponse = { items: [{ id: '123' }, { id: '456' }] };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      mockApi.buildQueryString = mock(() => '?limit=20&offset=0');
      handler = new ArtistsHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.getArtistAlbums({ id: '123' });

      expect(result).toEqual(mockResponse);
    });

    it('should throw error when limit is less than 1', async () => {
      await expect(handler.getArtistAlbums({ id: '123', limit: 0 })).rejects.toThrow();
    });

    it('should throw error when limit is greater than 50', async () => {
      await expect(handler.getArtistAlbums({ id: '123', limit: 51 })).rejects.toThrow();
    });

    it('should throw error when offset is negative', async () => {
      await expect(handler.getArtistAlbums({ id: '123', offset: -1 })).rejects.toThrow();
    });
  });
});
