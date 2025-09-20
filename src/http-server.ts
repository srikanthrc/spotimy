#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { AuthManager } from './utils/auth.js';
import { SpotifyApi } from './utils/api.js';
import { ArtistsHandler } from './handlers/artists.js';
import { AlbumsHandler } from './handlers/albums.js';
import { TracksHandler } from './handlers/tracks.js';
import { AudiobooksHandler } from './handlers/audiobooks.js';
import { PlaylistsHandler } from './handlers/playlists.js';
import { SearchHandler } from './handlers/search.js';

import {
  ArtistArgs,
  ArtistTopTracksArgs,
  ArtistRelatedArtistsArgs,
  ArtistAlbumsArgs,
  MultipleArtistsArgs,
} from './types/artists.js';
import {
  AlbumArgs,
  AlbumTracksArgs,
  MultipleAlbumsArgs,
  NewReleasesArgs,
} from './types/albums.js';
import {
  TrackArgs,
  RecommendationsArgs,
  UserTopTracksArgs,
} from './types/tracks.js';
import { AudiobookArgs, MultipleAudiobooksArgs, AudiobookChaptersArgs } from './types/audiobooks.js';
import { PlaylistArgs, PlaylistTracksArgs, PlaylistItemsArgs, ModifyPlaylistArgs, AddTracksToPlaylistArgs, RemoveTracksFromPlaylistArgs, GetCurrentUserPlaylistsArgs, GetFeaturedPlaylistsArgs, GetCategoryPlaylistsArgs } from './types/playlists.js';
import { SearchArgs as SearchArgsType } from './types/search.js';

class SpotifyHttpServer {
  private validateArgs<T>(args: Record<string, unknown> | undefined, requiredFields: string[]): T {
    if (!args) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Arguments are required'
      );
    }

    for (const field of requiredFields) {
      if (!(field in args)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Missing required field: ${field}`
        );
      }
    }

    return args as unknown as T;
  }

  private server: Server;
  private authManager: AuthManager;
  private api: SpotifyApi;
  private searchHandler: SearchHandler;
  private artistsHandler: ArtistsHandler;
  private albumsHandler: AlbumsHandler;
  private tracksHandler: TracksHandler;
  private audiobooksHandler: AudiobooksHandler;
  private playlistsHandler: PlaylistsHandler;
  private httpServer!: ReturnType<typeof createServer>;
  private transports = new Map<string, SSEServerTransport>();

  constructor() {
    this.server = new Server(
      {
        name: 'artistlens',
        version: '0.4.12',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.authManager = new AuthManager();
    this.api = new SpotifyApi(this.authManager);
    this.searchHandler = new SearchHandler(this.api);
    this.artistsHandler = new ArtistsHandler(this.api);
    this.albumsHandler = new AlbumsHandler(this.api);
    this.tracksHandler = new TracksHandler(this.api);
    this.audiobooksHandler = new AudiobooksHandler(this.api);
    this.playlistsHandler = new PlaylistsHandler(this.api);

    this.setupToolHandlers();
    this.setupHttpServer();

    this.server.onerror = (error) => console.error('[MCP Error]', error);

    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'get_access_token',
          description: 'Get a valid Spotify access token for API requests',
          inputSchema: {
            type: 'object',
            properties: {},
            required: []
          },
        },
        {
          name: 'search',
          description: 'Search for tracks, albums, artists, or playlists',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query'
              },
              type: {
                type: 'string',
                description: 'Type of item to search for',
                enum: ['track', 'album', 'artist', 'playlist']
              },
              limit: {
                type: 'number',
                description: 'Maximum number of results (1-50)',
                minimum: 1,
                maximum: 50,
                default: 20
              }
            },
            required: ['query', 'type']
          },
        },
        {
          name: 'get_artist',
          description: 'Get Spotify catalog information for an artist',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The Spotify ID or URI for the artist'
              }
            },
            required: ['id']
          },
        },
        {
          name: 'get_multiple_artists',
          description: 'Get Spotify catalog information for multiple artists',
          inputSchema: {
            type: 'object',
            properties: {
              ids: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of Spotify artist IDs or URIs (max 50)',
                maxItems: 50
              }
            },
            required: ['ids']
          },
        },
        {
          name: 'get_artist_top_tracks',
          description: 'Get Spotify catalog information about an artist\'s top tracks',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The Spotify ID or URI for the artist'
              },
              market: {
                type: 'string',
                description: 'Optional. An ISO 3166-1 alpha-2 country code'
              }
            },
            required: ['id']
          },
        },
        {
          name: 'get_artist_related_artists',
          description: 'Get Spotify catalog information about artists similar to a given artist',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The Spotify ID or URI for the artist'
              }
            },
            required: ['id']
          },
        },
        {
          name: 'get_artist_albums',
          description: 'Get Spotify catalog information about an artist\'s albums',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The Spotify ID or URI for the artist'
              },
              include_groups: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['album', 'single', 'appears_on', 'compilation']
                },
                description: 'Optional. Filter by album types'
              },
              limit: {
                type: 'number',
                description: 'Maximum number of albums to return (1-50)',
                minimum: 1,
                maximum: 50,
                default: 20
              },
              offset: {
                type: 'number',
                description: 'The index of the first album to return',
                minimum: 0,
                default: 0
              }
            },
            required: ['id']
          },
        },
        {
          name: 'get_album',
          description: 'Get Spotify catalog information for an album',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The Spotify ID or URI for the album'
              }
            },
            required: ['id']
          },
        },
        {
          name: 'get_album_tracks',
          description: 'Get Spotify catalog information for an album\'s tracks',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The Spotify ID or URI for the album'
              },
              limit: {
                type: 'number',
                description: 'Maximum number of tracks to return (1-50)',
                minimum: 1,
                maximum: 50,
                default: 20
              },
              offset: {
                type: 'number',
                description: 'The index of the first track to return',
                minimum: 0,
                default: 0
              }
            },
            required: ['id']
          },
        },
        {
          name: 'get_multiple_albums',
          description: 'Get Spotify catalog information for multiple albums',
          inputSchema: {
            type: 'object',
            properties: {
              ids: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of Spotify album IDs or URIs (max 20)',
                maxItems: 20
              }
            },
            required: ['ids']
          },
        },
        {
          name: 'get_track',
          description: 'Get Spotify catalog information for a track',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The Spotify ID or URI for the track'
              }
            },
            required: ['id']
          },
        },
        {
          name: 'get_available_genres',
          description: 'Get a list of available genres for recommendations',
          inputSchema: {
            type: 'object',
            properties: {},
            required: []
          },
        },
        {
          name: 'get_new_releases',
          description: 'Get a list of new album releases featured in Spotify',
          inputSchema: {
            type: 'object',
            properties: {
              country: {
                type: 'string',
                description: 'Optional. A country code (ISO 3166-1 alpha-2)'
              },
              limit: {
                type: 'number',
                description: 'Maximum number of releases to return (1-50)',
                minimum: 1,
                maximum: 50,
                default: 20
              },
              offset: {
                type: 'number',
                description: 'The index of the first release to return',
                minimum: 0,
                default: 0
              }
            }
          },
        },
        {
          name: 'get_recommendations',
          description: 'Get track recommendations based on seed tracks, artists, or genres',
          inputSchema: {
            type: 'object',
            properties: {
              seed_tracks: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of Spotify track IDs or URIs'
              },
              seed_artists: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of Spotify artist IDs or URIs'
              },
              seed_genres: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of genre names'
              },
              limit: {
                type: 'number',
                description: 'Maximum number of recommendations (1-100)',
                minimum: 1,
                maximum: 100,
                default: 20
              }
            },
            required: []
          },
        },
        {
          name: 'get_user_top_tracks',
          description: 'Get the current user\'s top tracks based on calculated affinity',
          inputSchema: {
            type: 'object',
            properties: {
              time_range: {
                type: 'string',
                enum: ['short_term', 'medium_term', 'long_term'],
                description: 'Over what time frame the affinities are computed. short_term (4 weeks), medium_term (6 months), long_term (several years)',
                default: 'medium_term'
              },
              limit: {
                type: 'number',
                description: 'Maximum number of tracks to return (1-50)',
                minimum: 1,
                maximum: 50,
                default: 20
              },
              offset: {
                type: 'number',
                description: 'The index of the first track to return',
                minimum: 0,
                default: 0
              }
            },
            required: []
          },
        },
        {
          name: 'get_audiobook',
          description: 'Get Spotify catalog information for an audiobook',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The Spotify ID or URI for the audiobook'
              },
              market: {
                type: 'string',
                description: 'Optional. An ISO 3166-1 alpha-2 country code'
              }
            },
            required: ['id']
          },
        },
        {
          name: 'get_multiple_audiobooks',
          description: 'Get Spotify catalog information for multiple audiobooks',
          inputSchema: {
            type: 'object',
            properties: {
              ids: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of Spotify audiobook IDs or URIs (max 50)',
                maxItems: 50
              },
              market: {
                type: 'string',
                description: 'Optional. An ISO 3166-1 alpha-2 country code'
              }
            },
            required: ['ids']
          },
        },
        {
          name: 'get_audiobook_chapters',
          description: 'Get Spotify catalog information about an audiobook\'s chapters',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The Spotify ID or URI for the audiobook'
              },
              market: {
                type: 'string',
                description: 'Optional. An ISO 3166-1 alpha-2 country code'
              },
              limit: {
                type: 'number',
                description: 'Maximum number of chapters to return (1-50)',
                minimum: 1,
                maximum: 50
              },
              offset: {
                type: 'number',
                description: 'The index of the first chapter to return',
                minimum: 0
              }
            },
            required: ['id']
          },
        },
        {
          name: 'get_playlist',
          description: 'Get a playlist owned by a Spotify user',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The Spotify ID or URI of the playlist'
              },
              market: {
                type: 'string',
                description: 'Optional. An ISO 3166-1 alpha-2 country code'
              }
            },
            required: ['id']
          },
        },
        {
          name: 'get_playlist_tracks',
          description: 'Get full details of the tracks of a playlist',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The Spotify ID or URI of the playlist'
              },
              market: {
                type: 'string',
                description: 'Optional. An ISO 3166-1 alpha-2 country code'
              },
              fields: {
                type: 'string',
                description: 'Optional. Filters for the query'
              },
              limit: {
                type: 'number',
                description: 'Optional. Maximum number of tracks to return (1-100)',
                minimum: 1,
                maximum: 100
              },
              offset: {
                type: 'number',
                description: 'Optional. Index of the first track to return',
                minimum: 0
              }
            },
            required: ['id']
          },
        },
        {
          name: 'get_playlist_items',
          description: 'Get full details of the items of a playlist',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The Spotify ID or URI of the playlist'
              },
              market: {
                type: 'string',
                description: 'Optional. An ISO 3166-1 alpha-2 country code'
              },
              fields: {
                type: 'string',
                description: 'Optional. Filters for the query'
              },
              limit: {
                type: 'number',
                description: 'Optional. Maximum number of items to return (1-100)',
                minimum: 1,
                maximum: 100
              },
              offset: {
                type: 'number',
                description: 'Optional. Index of the first item to return',
                minimum: 0
              }
            },
            required: ['id']
          },
        },
        {
          name: 'modify_playlist',
          description: 'Change a playlist\'s name and public/private state',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The Spotify ID or URI of the playlist'
              },
              name: {
                type: 'string',
                description: 'Optional. New name for the playlist'
              },
              public: {
                type: 'boolean',
                description: 'Optional. If true the playlist will be public'
              },
              collaborative: {
                type: 'boolean',
                description: 'Optional. If true, the playlist will become collaborative'
              },
              description: {
                type: 'string',
                description: 'Optional. New description for the playlist'
              }
            },
            required: ['id']
          },
        },
        {
          name: 'add_tracks_to_playlist',
          description: 'Add one or more tracks to a playlist',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The Spotify ID or URI of the playlist'
              },
              uris: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of Spotify track URIs to add'
              },
              position: {
                type: 'number',
                description: 'Optional. The position to insert the tracks (zero-based)',
                minimum: 0
              }
            },
            required: ['id', 'uris']
          },
        },
        {
          name: 'remove_tracks_from_playlist',
          description: 'Remove one or more tracks from a playlist',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The Spotify ID or URI of the playlist'
              },
              tracks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    uri: {
                      type: 'string',
                      description: 'Spotify URI of the track to remove'
                    },
                    positions: {
                      type: 'array',
                      items: {
                        type: 'number'
                      },
                      description: 'Optional positions of the track to remove'
                    }
                  },
                  required: ['uri']
                },
                description: 'Array of objects containing Spotify track URIs to remove'
              },
              snapshot_id: {
                type: 'string',
                description: 'Optional. The playlist\'s snapshot ID'
              }
            },
            required: ['id', 'tracks']
          },
        },
        {
          name: 'get_current_user_playlists',
          description: 'Get a list of the playlists owned or followed by the current Spotify user',
          inputSchema: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Maximum number of playlists to return (1-50)',
                minimum: 1,
                maximum: 50
              },
              offset: {
                type: 'number',
                description: 'The index of the first playlist to return',
                minimum: 0
              }
            }
          },
        },
        {
          name: 'get_featured_playlists',
          description: 'Get a list of Spotify featured playlists',
          inputSchema: {
            type: 'object',
            properties: {
              locale: {
                type: 'string',
                description: 'Optional. Desired language (format: es_MX)'
              },
              limit: {
                type: 'number',
                description: 'Optional. Maximum number of playlists (1-50)',
                minimum: 1,
                maximum: 50
              },
              offset: {
                type: 'number',
                description: 'Optional. Index of the first playlist to return',
                minimum: 0
              }
            }
          },
        },
        {
          name: 'get_category_playlists',
          description: 'Get a list of Spotify playlists tagged with a particular category',
          inputSchema: {
            type: 'object',
            properties: {
              category_id: {
                type: 'string',
                description: 'The Spotify category ID'
              },
              limit: {
                type: 'number',
                description: 'Optional. Maximum number of playlists (1-50)',
                minimum: 1,
                maximum: 50
              },
              offset: {
                type: 'number',
                description: 'Optional. Index of the first playlist to return',
                minimum: 0
              }
            },
            required: ['category_id']
          },
        }
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case 'get_access_token': {
            const token = await this.authManager.getAccessToken();
            return {
              content: [{ type: 'text', text: token }],
            };
          }

          case 'search': {
            const args = this.validateArgs<SearchArgsType>(request.params.arguments, ['query', 'type']);
            const result = await this.searchHandler.search(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'get_artist': {
            const args = this.validateArgs<ArtistArgs>(request.params.arguments, ['id']);
            const result = await this.artistsHandler.getArtist(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'get_multiple_artists': {
            const args = this.validateArgs<MultipleArtistsArgs>(request.params.arguments, ['ids']);
            const result = await this.artistsHandler.getMultipleArtists(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'get_artist_top_tracks': {
            const args = this.validateArgs<ArtistTopTracksArgs>(request.params.arguments, ['id']);
            const result = await this.artistsHandler.getArtistTopTracks(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'get_artist_related_artists': {
            const args = this.validateArgs<ArtistRelatedArtistsArgs>(request.params.arguments, ['id']);
            const result = await this.artistsHandler.getArtistRelatedArtists(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'get_artist_albums': {
            const args = this.validateArgs<ArtistAlbumsArgs>(request.params.arguments, ['id']);
            const result = await this.artistsHandler.getArtistAlbums(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'get_album': {
            const args = this.validateArgs<AlbumArgs>(request.params.arguments, ['id']);
            const result = await this.albumsHandler.getAlbum(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'get_album_tracks': {
            const args = this.validateArgs<AlbumTracksArgs>(request.params.arguments, ['id']);
            const result = await this.albumsHandler.getAlbumTracks(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'get_multiple_albums': {
            const args = this.validateArgs<MultipleAlbumsArgs>(request.params.arguments, ['ids']);
            const result = await this.albumsHandler.getMultipleAlbums(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'get_track': {
            const args = this.validateArgs<TrackArgs>(request.params.arguments, ['id']);
            const result = await this.tracksHandler.getTrack(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'get_available_genres': {
            const result = await this.tracksHandler.getAvailableGenres();
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
            };
          }

          case 'get_new_releases': {
            const args = this.validateArgs<NewReleasesArgs>(request.params.arguments || {}, []);
            const result = await this.albumsHandler.getNewReleases(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'get_recommendations': {
            const args = this.validateArgs<RecommendationsArgs>(request.params.arguments || {}, []);
            const result = await this.tracksHandler.getRecommendations(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'get_user_top_tracks': {
            const args = this.validateArgs<UserTopTracksArgs>(request.params.arguments || {}, []);
            const result = await this.tracksHandler.getUserTopTracks(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'get_audiobook': {
            const args = this.validateArgs<AudiobookArgs>(request.params.arguments, ['id']);
            const result = await this.audiobooksHandler.getAudiobook(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'get_multiple_audiobooks': {
            const args = this.validateArgs<MultipleAudiobooksArgs>(request.params.arguments, ['ids']);
            const result = await this.audiobooksHandler.getMultipleAudiobooks(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'get_audiobook_chapters': {
            const args = this.validateArgs<AudiobookChaptersArgs>(request.params.arguments, ['id']);
            const result = await this.audiobooksHandler.getAudiobookChapters(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'get_playlist': {
            const args = this.validateArgs<PlaylistArgs>(request.params.arguments, ['id']);
            const result = await this.playlistsHandler.getPlaylist(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'get_playlist_tracks': {
            const args = this.validateArgs<PlaylistTracksArgs>(request.params.arguments, ['id']);
            const result = await this.playlistsHandler.getPlaylistTracks(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'get_playlist_items': {
            const args = this.validateArgs<PlaylistItemsArgs>(request.params.arguments, ['id']);
            const result = await this.playlistsHandler.getPlaylistItems(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'modify_playlist': {
            const args = this.validateArgs<ModifyPlaylistArgs>(request.params.arguments, ['id']);
            const result = await this.playlistsHandler.modifyPlaylist(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'add_tracks_to_playlist': {
            const args = this.validateArgs<AddTracksToPlaylistArgs>(request.params.arguments, ['id', 'uris']);
            const result = await this.playlistsHandler.addTracksToPlaylist(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'remove_tracks_from_playlist': {
            const args = this.validateArgs<RemoveTracksFromPlaylistArgs>(request.params.arguments, ['id', 'tracks']);
            const result = await this.playlistsHandler.removeTracksFromPlaylist(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'get_current_user_playlists': {
            const args = this.validateArgs<GetCurrentUserPlaylistsArgs>(request.params.arguments || {}, []);
            const result = await this.playlistsHandler.getCurrentUserPlaylists(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'get_featured_playlists': {
            const args = this.validateArgs<GetFeaturedPlaylistsArgs>(request.params.arguments || {}, []);
            const result = await this.playlistsHandler.getFeaturedPlaylists(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'get_category_playlists': {
            const args = this.validateArgs<GetCategoryPlaylistsArgs>(request.params.arguments, ['category_id']);
            const result = await this.playlistsHandler.getCategoryPlaylists(args);
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Unexpected error: ${error}`
        );
      }
    });
  }

  private setupHttpServer() {
    this.httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url!, `http://${req.headers.host}`);

        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Mcp-Session-Id');

        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        // Health check endpoint
        if (url.pathname === '/health') {
          try {
            // Check Spotify auth status (get fresh env vars)
            await this.authManager.getAccessToken(); // This will refresh env vars
            const hasUserToken = !!process.env.SPOTIFY_USER_ACCESS_TOKEN;
            const hasAuthCode = !!process.env.SPOTIFY_AUTH_CODE;
            const hasClientCredentials = !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);

            let authStatus = 'No authentication';
            let authDetails: any = {};
            let tokenValid = false;

            if (hasUserToken) {
              // Test if the user token is still valid by making a simple API call
              try {
                const token = await this.authManager.getAccessToken();
                const testResponse = await fetch('https://api.spotify.com/v1/me', {
                  headers: {
                    'Authorization': `Bearer ${token}`
                  }
                });

                if (testResponse.ok) {
                  const userData = await testResponse.json();
                  authStatus = 'User token active';
                  tokenValid = true;
                  authDetails = {
                    userToken: `${process.env.SPOTIFY_USER_ACCESS_TOKEN?.substring(0, 20)}...`,
                    userId: userData.id,
                    displayName: userData.display_name,
                    hasAuthCode: hasAuthCode,
                    authCode: hasAuthCode ? `${process.env.SPOTIFY_AUTH_CODE?.substring(0, 20)}...` : null
                  };
                } else {
                  authStatus = 'User token expired/invalid';
                  authDetails = {
                    userToken: `${process.env.SPOTIFY_USER_ACCESS_TOKEN?.substring(0, 20)}...`,
                    error: `HTTP ${testResponse.status}: ${testResponse.statusText}`,
                    hasAuthCode: hasAuthCode
                  };
                }
              } catch (error) {
                authStatus = 'User token error';
                authDetails = {
                  userToken: `${process.env.SPOTIFY_USER_ACCESS_TOKEN?.substring(0, 20)}...`,
                  error: error instanceof Error ? error.message : String(error),
                  hasAuthCode: hasAuthCode
                };
              }
            } else if (hasClientCredentials) {
              // Test client credentials
              try {
                const token = await this.authManager.getAccessToken();
                const testResponse = await fetch('https://api.spotify.com/v1/browse/categories?limit=1', {
                  headers: {
                    'Authorization': `Bearer ${token}`
                  }
                });

                if (testResponse.ok) {
                  authStatus = 'Client credentials active';
                  tokenValid = true;
                  authDetails = {
                    clientId: process.env.SPOTIFY_CLIENT_ID?.substring(0, 8) + '...',
                    hasClientSecret: !!process.env.SPOTIFY_CLIENT_SECRET,
                    scope: 'App-only access'
                  };
                } else {
                  authStatus = 'Client credentials invalid';
                  authDetails = {
                    clientId: process.env.SPOTIFY_CLIENT_ID?.substring(0, 8) + '...',
                    error: `HTTP ${testResponse.status}: ${testResponse.statusText}`
                  };
                }
              } catch (error) {
                authStatus = 'Client credentials error';
                authDetails = {
                  clientId: process.env.SPOTIFY_CLIENT_ID?.substring(0, 8) + '...',
                  error: error instanceof Error ? error.message : String(error)
                };
              }
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              status: 'ok',
              message: 'SpotiMy MCP Server is running',
              timestamp: new Date().toISOString(),
              auth: {
                status: authStatus,
                tokenValid,
                hasUserToken,
                hasAuthCode,
                hasClientCredentials,
                details: authDetails
              }
            }));
          } catch (error) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              status: 'ok',
              message: 'SpotiMy MCP Server is running',
              timestamp: new Date().toISOString(),
              auth: {
                status: 'Error checking auth',
                tokenValid: false,
                error: error instanceof Error ? error.message : String(error)
              }
            }));
          }
          return;
        }

        // OAuth authorization endpoint
        if (url.pathname === '/auth') {
          if (req.method === 'GET') {
            const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '3d134834f4da49eab306ec763d994ef1';
            const REDIRECT_URI = `http://127.0.0.1:3001/callback`;
            const SCOPES = 'playlist-read-private playlist-read-collaborative user-read-private user-top-read';
            const AUTH_URL = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}`;

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <head><title>Spotify Authorization</title></head>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                  <h1>🎵 Spotify Authorization</h1>
                  <p>Click the button below to authorize the MCP server to access your Spotify data:</p>
                  <p><a href="${AUTH_URL}" style="background: #1db954; color: white; padding: 12px 24px; text-decoration: none; border-radius: 25px; font-weight: bold;">Authorize Spotify Access</a></p>
                  <p style="margin-top: 30px; color: #666; font-size: 12px;">
                    This will redirect you to Spotify's authorization page.<br>
                    After authorization, you'll be redirected back to this server.
                  </p>
                  <p style="margin-top: 20px; color: #999; font-size: 11px;">
                    Authorization URL: <code style="background: #f5f5f5; padding: 2px 4px;">${AUTH_URL}</code>
                  </p>
                </body>
              </html>
            `);
          } else {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed. Use GET.' }));
          }
          return;
        }

        // OAuth callback endpoint
        if (url.pathname === '/callback') {
          if (req.method === 'GET') {
            const code = url.searchParams.get('code');
            const error = url.searchParams.get('error');

            if (error) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h1 style="color: #e22134;">❌ Authorization Error</h1>
                    <p>Error: ${error}</p>
                    <p>You can close this window and try again.</p>
                  </body>
                </html>
              `);
              return;
            }

            if (!code) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h1>❌ No Authorization Code</h1>
                    <p>No authorization code was provided in the callback.</p>
                    <p><a href="/auth">Try again</a></p>
                  </body>
                </html>
              `);
              return;
            }

            try {
              // Update .env file with new auth code
              const envPath = path.join(process.cwd(), '.env');
              const envContent = fs.readFileSync(envPath, 'utf8');
              const updatedEnv = envContent.replace(
                /SPOTIFY_AUTH_CODE="[^"]*"/,
                `SPOTIFY_AUTH_CODE="${code}"`
              );
              fs.writeFileSync(envPath, updatedEnv);

              // Exchange code for access token
              const response = await fetch('https://accounts.spotify.com/api/token', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                  grant_type: 'authorization_code',
                  code: code,
                  redirect_uri: `http://127.0.0.1:3001/callback`,
                  client_id: process.env.SPOTIFY_CLIENT_ID!,
                  client_secret: process.env.SPOTIFY_CLIENT_SECRET!
                })
              });

              if (!response.ok) {
                throw new Error(`Token exchange failed: ${response.status} ${response.statusText}`);
              }

              const tokenData = await response.json();

              if (!tokenData.access_token) {
                throw new Error('No access token received');
              }

              // Update .env with new access token
              const newEnvContent = fs.readFileSync(envPath, 'utf8');
              const finalEnv = newEnvContent.replace(
                /SPOTIFY_USER_ACCESS_TOKEN="[^"]*"/,
                `SPOTIFY_USER_ACCESS_TOKEN="${tokenData.access_token}"`
              );
              fs.writeFileSync(envPath, finalEnv);

              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h1 style="color: #1db954;">✅ Authorization Successful!</h1>
                    <p>Your Spotify access token has been updated and is ready to use.</p>
                    <p>You can now close this window and use the MCP server.</p>
                    <p style="margin-top: 30px; color: #666;">
                      Access Token: ${tokenData.access_token.substring(0, 20)}...
                    </p>
                    <p style="margin-top: 20px;">
                      <a href="/health" style="background: #1db954; color: white; padding: 8px 16px; text-decoration: none; border-radius: 4px;">Check Server Status</a>
                    </p>
                  </body>
                </html>
              `);

            } catch (error) {
              res.writeHead(500, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                    <h1 style="color: #e22134;">❌ Token Exchange Error</h1>
                    <p>Failed to exchange authorization code for access token.</p>
                    <p style="color: #666;">Error: ${error instanceof Error ? error.message : String(error)}</p>
                    <p><a href="/auth">Try again</a></p>
                  </body>
                </html>
              `);
            }
          } else {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed. Use GET.' }));
          }
          return;
        }

        // Token refresh endpoint
        if (url.pathname === '/refresh-token') {
          if (req.method === 'POST') {
            try {
              const refreshed = await this.authManager.refreshToken();
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: true,
                message: 'Token refreshed successfully',
                token: refreshed ? 'Updated' : 'Already valid'
              }));
            } catch (error) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: false,
                error: 'Failed to refresh token',
                details: error instanceof Error ? error.message : String(error)
              }));
            }
          } else {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
          }
          return;
        }

        // MCP endpoint
        if (url.pathname === '/mcp') {
          if (req.method === 'GET') {
            // Initialize SSE connection
            const transport = new SSEServerTransport('/mcp', res);
            this.transports.set(transport.sessionId, transport);

            // Set up transport event handlers
            transport.onclose = () => {
              this.transports.delete(transport.sessionId);
            };

            transport.onerror = (error) => {
              console.error('[SSE Error]', error);
            };

            // Connect the MCP server to this transport
            await this.server.connect(transport);

          } else if (req.method === 'POST') {
            // Handle incoming messages
            const sessionId = url.searchParams.get('sessionId');

            if (!sessionId) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing sessionId parameter' }));
              return;
            }

            const transport = this.transports.get(sessionId);
            if (!transport) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Session not found' }));
              return;
            }

            await transport.handlePostMessage(req, res);
          } else {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
          }
          return;
        }

        // 404 for other paths
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));

      } catch (error) {
        console.error('[HTTP Server Error]', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
  }

  async listen(port: number = 3000, host: string = '127.0.0.1') {
    return new Promise<void>((resolve, reject) => {
      this.httpServer.listen(port, host, () => {
        console.error(`SpotiMy MCP HTTP server running on http://${host}:${port}`);
        console.error('Endpoints:');
        console.error('  GET  /mcp           - MCP SSE connection');
        console.error('  POST /mcp          - MCP message endpoint');
        console.error('  GET  /health       - Health check');
        console.error('  GET  /auth         - Start Spotify OAuth flow');
        console.error('  GET  /callback     - Spotify OAuth callback');
        console.error('  POST /refresh-token - Refresh Spotify access token');
        resolve();
      });

      this.httpServer.on('error', reject);
    });
  }

  async cleanup() {
    // Close all transports
    for (const transport of this.transports.values()) {
      await transport.close();
    }
    this.transports.clear();

    // Close HTTP server
    if (this.httpServer) {
      return new Promise<void>((resolve) => {
        this.httpServer.close(() => resolve());
      });
    }

    // Close MCP server
    await this.server.close();
  }
}

// Only run the server if this file is executed directly
if (import.meta.main) {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const portArg = args.find(arg => arg.startsWith('--port='));
  const hostArg = args.find(arg => arg.startsWith('--host='));

  // Get port and host from environment variables, with command line arguments taking precedence
  const port = portArg
    ? parseInt(portArg.split('=')[1], 10)
    : parseInt(process.env.HTTP_PORT || '3000', 10);

  const host = hostArg
    ? hostArg.split('=')[1]
    : process.env.HTTP_HOST || '127.0.0.1';

  const server = new SpotifyHttpServer();
  server.listen(port, host).catch(console.error);
}

export default SpotifyHttpServer;