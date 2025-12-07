import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { AlbumsHandler } from '../handlers/albums.js';
import { SpotifyApi } from '../utils/api.js';

describe('AlbumsHandler', () => {
  let handler: AlbumsHandler;
  let mockApi: { makeRequest: ReturnType<typeof mock>; buildQueryString: ReturnType<typeof mock> };

  beforeEach(() => {
    mockApi = {
      makeRequest: mock(() => Promise.resolve({})),
      buildQueryString: mock(() => ''),
    };
    handler = new AlbumsHandler(mockApi as unknown as SpotifyApi);
  });

  describe('getAlbum', () => {
    it('should fetch an album by ID', async () => {
      const mockResponse = { id: '123', name: 'Test Album' };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      handler = new AlbumsHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.getAlbum({ id: '123' });

      expect(mockApi.makeRequest).toHaveBeenCalledWith('/albums/123');
      expect(result).toEqual(mockResponse);
    });

    it('should handle spotify:album: prefixed IDs', async () => {
      const mockResponse = { id: '123', name: 'Test Album' };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      handler = new AlbumsHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.getAlbum({ id: 'spotify:album:123' });

      expect(mockApi.makeRequest).toHaveBeenCalledWith('/albums/123');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getMultipleAlbums', () => {
    it('should fetch multiple albums by IDs', async () => {
      const mockResponse = { albums: [{ id: '123' }, { id: '456' }] };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      handler = new AlbumsHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.getMultipleAlbums({ ids: ['123', '456'] });

      expect(mockApi.makeRequest).toHaveBeenCalledWith('/albums?ids=123,456');
      expect(result).toEqual(mockResponse);
    });

    it('should throw error when no IDs provided', async () => {
      await expect(handler.getMultipleAlbums({ ids: [] })).rejects.toThrow();
    });

    it('should throw error when too many IDs provided', async () => {
      const ids = Array(21).fill('123');
      await expect(handler.getMultipleAlbums({ ids })).rejects.toThrow();
    });
  });

  describe('getAlbumTracks', () => {
    it('should fetch album tracks', async () => {
      const mockResponse = { items: [{ id: '123' }, { id: '456' }] };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      mockApi.buildQueryString = mock(() => '?limit=20&offset=0');
      handler = new AlbumsHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.getAlbumTracks({ id: '123' });

      expect(result).toEqual(mockResponse);
    });

    it('should throw error when limit is less than 1', async () => {
      await expect(handler.getAlbumTracks({ id: '123', limit: 0 })).rejects.toThrow();
    });

    it('should throw error when limit is greater than 50', async () => {
      await expect(handler.getAlbumTracks({ id: '123', limit: 51 })).rejects.toThrow();
    });
  });

  describe('getNewReleases', () => {
    it('should fetch new releases', async () => {
      const mockResponse = { albums: { items: [{ id: '123' }] } };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      mockApi.buildQueryString = mock(() => '?limit=20&offset=0');
      handler = new AlbumsHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.getNewReleases({});

      expect(result).toEqual(mockResponse);
    });
  });
});
