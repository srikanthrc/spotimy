import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { AudiobooksHandler } from '../handlers/audiobooks.js';
import { SpotifyApi } from '../utils/api.js';

describe('AudiobooksHandler', () => {
  let handler: AudiobooksHandler;
  let mockApi: { makeRequest: ReturnType<typeof mock>; buildQueryString: ReturnType<typeof mock> };

  beforeEach(() => {
    mockApi = {
      makeRequest: mock(() => Promise.resolve({})),
      buildQueryString: mock(() => ''),
    };
    handler = new AudiobooksHandler(mockApi as unknown as SpotifyApi);
  });

  describe('getAudiobook', () => {
    it('should fetch an audiobook by ID', async () => {
      const mockResponse = { id: '123', name: 'Test Audiobook' };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      handler = new AudiobooksHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.getAudiobook({ id: '123' });

      expect(result).toEqual(mockResponse);
    });

    it('should handle spotify:show: prefixed IDs', async () => {
      const mockResponse = { id: '123', name: 'Test Audiobook' };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      handler = new AudiobooksHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.getAudiobook({ id: 'spotify:show:123' });

      expect(result).toEqual(mockResponse);
    });
  });

  describe('getMultipleAudiobooks', () => {
    it('should fetch multiple audiobooks by IDs', async () => {
      const mockResponse = { audiobooks: [{ id: '123' }, { id: '456' }] };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      handler = new AudiobooksHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.getMultipleAudiobooks({ ids: ['123', '456'] });

      expect(result).toEqual(mockResponse);
    });

    it('should throw error when no IDs provided', async () => {
      await expect(handler.getMultipleAudiobooks({ ids: [] })).rejects.toThrow();
    });

    it('should throw error when too many IDs provided', async () => {
      const ids = Array(51).fill('123');
      await expect(handler.getMultipleAudiobooks({ ids })).rejects.toThrow();
    });
  });

  describe('getAudiobookChapters', () => {
    it('should fetch audiobook chapters', async () => {
      const mockResponse = { items: [{ id: '123' }, { id: '456' }] };
      mockApi.makeRequest = mock(() => Promise.resolve(mockResponse));
      mockApi.buildQueryString = mock(() => '?limit=20&offset=0');
      handler = new AudiobooksHandler(mockApi as unknown as SpotifyApi);

      const result = await handler.getAudiobookChapters({ id: '123' });

      expect(result).toEqual(mockResponse);
    });
  });
});
