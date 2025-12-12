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
import packageJson from '../package.json' assert { type: 'json' };

import logger from './utils/logger.js';
import { outputSchemas, stripToSchema } from './schemas.js';
import { AuthManager } from './utils/auth.js';
import { SpotifyApi } from './utils/api.js';
import { ClientRegistrationManager } from './utils/client-registration.js';
import { ArtistsHandler } from './handlers/artists.js';
import { AlbumsHandler } from './handlers/albums.js';
import { TracksHandler } from './handlers/tracks.js';
import { AudiobooksHandler } from './handlers/audiobooks.js';
import { ShowsHandler } from './handlers/shows.js';
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
import { ShowArgs, ShowEpisodesArgs } from './types/shows.js';
import { PlaylistArgs, PlaylistTracksArgs, PlaylistItemsArgs, ModifyPlaylistArgs, AddTracksToPlaylistArgs, RemoveTracksFromPlaylistArgs, GetCurrentUserPlaylistsArgs, CreatePlaylistArgs } from './types/playlists.js';
import { SearchArgs as SearchArgsType } from './types/search.js';

class SpotifyHttpServer {
  // Cache auth status for 5 seconds to reduce DB lookups during rapid reconnection attempts
  private authStatusCache = new Map<string, { status: any; timestamp: number }>();
  private readonly AUTH_CACHE_TTL = 5000; // 5 seconds

  // Required OAuth scopes for accessing this MCP server (RFC 6750 Section 3)
  private readonly REQUIRED_SCOPES_ARRAY = [
    'playlist-read-private',
    'playlist-read-collaborative',
    'user-read-private',
    'user-top-read',
    'playlist-modify-public',
    'playlist-modify-private'
  ];
  private readonly REQUIRED_SCOPES = this.REQUIRED_SCOPES_ARRAY.join(' ');

  private getFaviconPath(): string {
    // Try to find favicon in multiple locations (dev vs prod)
    const possiblePaths = [
      path.join(process.cwd(), 'src', 'static', 'favicon.png'),        // Dev: from project root
      path.join(process.cwd(), 'build', 'static', 'favicon.png'),      // Prod: from project root
      path.join(__dirname, 'static', 'favicon.png'),                   // Relative to current file
      path.join(__dirname, '..', 'src', 'static', 'favicon.png'),      // One level up
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    throw new Error('Favicon not found in any expected location');
  }

  private async getCachedAuthStatus(sessionId: string): Promise<any> {
    const now = Date.now();
    const cached = this.authStatusCache.get(sessionId);
    
    if (cached && (now - cached.timestamp) < this.AUTH_CACHE_TTL) {
      return cached.status;
    }

    const status = await this.authManager.getAuthStatus(sessionId);
    this.authStatusCache.set(sessionId, { status, timestamp: now });
    
    return status;
  }

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

  private async getNgrokStatus() {
    const ngrokAuthToken = process.env.NGROK_AUTH_TOKEN;
    
    if (!ngrokAuthToken) {
      return {
        status: 'Disabled',
        enabled: false,
        reason: 'No NGROK_AUTH_TOKEN provided',
        access: 'Local only'
      };
    }

    try {
      // Try to fetch tunnel info from ngrok API
      const response = await fetch('http://localhost:4040/api/tunnels');
      
      if (!response.ok) {
        throw new Error(`Ngrok API returned ${response.status}`);
      }

      const data = await response.json();
      
      if (data.tunnels && data.tunnels.length > 0) {
        const tunnel = data.tunnels[0];
        return {
          status: 'Active',
          enabled: true,
          publicUrl: tunnel.public_url,
          localUrl: tunnel.config.addr,
          protocol: tunnel.proto,
          connections: tunnel.metrics?.conns?.gauge || 0,
          totalRequests: tunnel.metrics?.http?.count || 0,
          webInterface: 'http://localhost:4040'
        };
      } else {
        return {
          status: 'No tunnels',
          enabled: true,
          reason: 'Ngrok is configured but no active tunnels found',
          webInterface: 'http://localhost:4040'
        };
      }
    } catch (error) {
      return {
        status: 'Error',
        enabled: true,
        reason: 'Ngrok is configured but not accessible',
        error: error instanceof Error ? error.message : String(error),
        note: 'Tunnel may still be starting up'
      };
    }
  }

  private server: Server;
  private authManager: AuthManager;
  private clientRegistrationManager: ClientRegistrationManager;
  private api: SpotifyApi;
  private searchHandler: SearchHandler;
  private artistsHandler: ArtistsHandler;
  private albumsHandler: AlbumsHandler;
  private tracksHandler: TracksHandler;
  private audiobooksHandler: AudiobooksHandler;
  private showsHandler: ShowsHandler;
  private playlistsHandler: PlaylistsHandler;
  private httpServer!: ReturnType<typeof createServer>;
  private transports = new Map<string, SSEServerTransport>();
  private sessionIdMapping = new Map<string, string>(); // Maps transport sessionId -> custom sessionId
  private currentSessionId?: string;

  constructor() {
    this.server = new Server(
      {
        name: packageJson.name,
        version: packageJson.version,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.authManager = new AuthManager();
    // Use the same data directory as AuthManager for consistency
    const dataDir = process.env.TOKEN_STORE_PATH || './data';
    this.clientRegistrationManager = new ClientRegistrationManager(path.join(dataDir, 'clients.db'));
    this.api = new SpotifyApi(this.authManager);
    this.searchHandler = new SearchHandler(this.api);
    this.artistsHandler = new ArtistsHandler(this.api);
    this.albumsHandler = new AlbumsHandler(this.api);
    this.tracksHandler = new TracksHandler(this.api);
    this.audiobooksHandler = new AudiobooksHandler(this.api);
    this.showsHandler = new ShowsHandler(this.api);
    this.playlistsHandler = new PlaylistsHandler(this.api);

    this.setupToolHandlers();
    this.setupHttpServer();

    this.server.onerror = (error) => logger.error({ error }, 'MCP Error');

    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  private getCurrentSessionId(): string | undefined {
    return this.currentSessionId;
  }

  private getBaseUrl(req: IncomingMessage): string {
    // Check for ngrok domain first
    const ngrokDomain = process.env.NGROK_DOMAIN;
    if (ngrokDomain) {
      return `https://${ngrokDomain}`;
    }

    // Use forwarded host if behind proxy
    const forwardedHost = req.headers['x-forwarded-host'];
    const forwardedProto = req.headers['x-forwarded-proto'];
    if (forwardedHost) {
      const proto = forwardedProto || 'http';
      return `${proto}://${forwardedHost}`;
    }

    // Fallback to configured host and port
    const host = process.env.HTTP_HOST || '127.0.0.1';
    const port = process.env.HTTP_PORT || '3001';
    return `http://${host}:${port}`;
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const toolsWithOutputSchema = [
        {
          name: 'get_session_info',
          description: 'Get current session ID and authentication status. Use this to find your session ID for authorization.',
          inputSchema: {
            type: 'object',
            properties: {},
            required: []
          },
          outputSchema: outputSchemas.get_session_info
        },
        {
          name: 'get_access_token',
          description: 'Get a valid Spotify access token for API requests',
          inputSchema: {
            type: 'object',
            properties: {},
            required: []
          },
          outputSchema: outputSchemas.get_access_token
        },
        {
          name: 'search',
          description: 'Search for tracks, albums, artists, playlists, shows (podcasts), or episodes',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query'
              },
              type: {
                type: 'string',
                description: 'Type of item to search for: track, album, artist, playlist, show, or episode',
                enum: ['track', 'album', 'artist', 'playlist', 'show', 'episode']
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
          outputSchema: outputSchemas.search
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
          outputSchema: outputSchemas.get_artist
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
          outputSchema: outputSchemas.get_multiple_artists
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
          outputSchema: outputSchemas.get_artist_top_tracks
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
          outputSchema: outputSchemas.get_artist_related_artists
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
                description: 'Optional. Filter by album types: album, single, appears_on, compilation'
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
          outputSchema: outputSchemas.get_artist_albums
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
          outputSchema: outputSchemas.get_album
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
          outputSchema: outputSchemas.get_album_tracks
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
          outputSchema: outputSchemas.get_multiple_albums
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
          outputSchema: outputSchemas.get_track
        },
        {
          name: 'get_available_genres',
          description: 'Get a list of available genres for recommendations',
          inputSchema: {
            type: 'object',
            properties: {},
            required: []
          },
          outputSchema: outputSchemas.get_available_genres
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
          outputSchema: outputSchemas.get_new_releases
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
          outputSchema: outputSchemas.get_recommendations
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
          outputSchema: outputSchemas.get_audiobook
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
          outputSchema: outputSchemas.get_multiple_audiobooks
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
          outputSchema: outputSchemas.get_audiobook_chapters
        },
        {
          name: 'get_show',
          description: 'Get Spotify catalog information for a podcast show',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The Spotify ID or URI for the show'
              },
              market: {
                type: 'string',
                description: 'Optional. An ISO 3166-1 alpha-2 country code'
              }
            },
            required: ['id']
          },
          outputSchema: outputSchemas.get_show
        },
        {
          name: 'get_show_episodes',
          description: 'Get Spotify catalog information about a show\'s episodes',
          inputSchema: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'The Spotify ID or URI for the show'
              },
              market: {
                type: 'string',
                description: 'Optional. An ISO 3166-1 alpha-2 country code'
              },
              limit: {
                type: 'number',
                description: 'Maximum number of episodes to return (1-50)',
                minimum: 1,
                maximum: 50
              },
              offset: {
                type: 'number',
                description: 'The index of the first episode to return',
                minimum: 0
              }
            },
            required: ['id']
          },
          outputSchema: outputSchemas.get_show_episodes
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
          outputSchema: outputSchemas.get_playlist
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
          outputSchema: outputSchemas.get_playlist_tracks
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
          outputSchema: outputSchemas.get_playlist_items
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
          outputSchema: outputSchemas.modify_playlist
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
          outputSchema: outputSchemas.add_tracks_to_playlist
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
          outputSchema: outputSchemas.remove_tracks_from_playlist
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
          outputSchema: outputSchemas.get_user_top_tracks
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
          outputSchema: outputSchemas.get_current_user_playlists
        },
        {
          name: 'create_playlist',
          description: 'Create a new playlist for the current user',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'The name for the new playlist'
              },
              description: {
                type: 'string',
                description: 'Optional. Description for the playlist'
              },
              public: {
                type: 'boolean',
                description: 'Optional. If true the playlist will be public, if false it will be private. Default: true'
              },
              collaborative: {
                type: 'boolean',
                description: 'Optional. If true the playlist will be collaborative. Note: to create a collaborative playlist you must also set public to false.'
              }
            },
            required: ['name']
          },
          outputSchema: outputSchemas.create_playlist
        }
      ] as any; // Type assertion to preserve outputSchema fields
      return {
        tools: toolsWithOutputSchema
      };
    });

    // Helper function to format tool responses with structuredContent (MCP 2024-11-05+)
    // Uses stripToSchema from schemas.ts to ensure responses match schema exactly
    const formatToolResponse = (result: unknown, toolName: string): {
      content: Array<{ type: string; text: string }>;
      structuredContent?: unknown;
    } => {
      const schema = outputSchemas[toolName];
      const stripped = schema ? stripToSchema(result, schema) : result;
      return {
        content: [{ type: 'text', text: JSON.stringify(stripped, null, 2) }],
        structuredContent: stripped
      };
    };

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        // Set session context for this request
        const sessionId = this.getCurrentSessionId();
        this.api.setSessionId(sessionId);

        switch (request.params.name) {
          case 'get_session_info': {
            const authStatus = await this.authManager.getAuthStatus(sessionId);
            const info = {
              sessionId: sessionId || 'unknown',
              authUrl: sessionId ? `${process.env.NGROK_DOMAIN ? 'https://' + process.env.NGROK_DOMAIN : 'http://localhost:' + (process.env.HTTP_PORT || '3001')}/auth?sessionId=${sessionId}` : 'Connect first to get session ID',
              ...authStatus
            };
            return formatToolResponse(info, 'get_session_info');
          }

          case 'get_access_token': {
            const token = await this.authManager.getAccessToken(sessionId);
            return formatToolResponse({ token }, 'get_access_token');
          }

          case 'search': {
            const args = this.validateArgs<SearchArgsType>(request.params.arguments, ['query', 'type']);
            const result = await this.searchHandler.search(args);
            return formatToolResponse(result, 'search');
          }

          case 'get_artist': {
            const args = this.validateArgs<ArtistArgs>(request.params.arguments, ['id']);
            const result = await this.artistsHandler.getArtist(args);
            return formatToolResponse(result, 'get_artist');
          }

          case 'get_multiple_artists': {
            const args = this.validateArgs<MultipleArtistsArgs>(request.params.arguments, ['ids']);
            const result = await this.artistsHandler.getMultipleArtists(args);
            return formatToolResponse(result, 'get_multiple_artists');
          }

          case 'get_artist_top_tracks': {
            const args = this.validateArgs<ArtistTopTracksArgs>(request.params.arguments, ['id']);
            const result = await this.artistsHandler.getArtistTopTracks(args);
            return formatToolResponse(result, 'get_artist_top_tracks');
          }

          case 'get_artist_related_artists': {
            const args = this.validateArgs<ArtistRelatedArtistsArgs>(request.params.arguments, ['id']);
            const result = await this.artistsHandler.getArtistRelatedArtists(args);
            return formatToolResponse(result, 'get_artist_related_artists');
          }

          case 'get_artist_albums': {
            const args = this.validateArgs<ArtistAlbumsArgs>(request.params.arguments, ['id']);
            const result = await this.artistsHandler.getArtistAlbums(args);
            return formatToolResponse(result, 'get_artist_albums');
          }

          case 'get_album': {
            const args = this.validateArgs<AlbumArgs>(request.params.arguments, ['id']);
            const result = await this.albumsHandler.getAlbum(args);
            return formatToolResponse(result, 'get_album');
          }

          case 'get_album_tracks': {
            const args = this.validateArgs<AlbumTracksArgs>(request.params.arguments, ['id']);
            const result = await this.albumsHandler.getAlbumTracks(args);
            return formatToolResponse(result, 'get_album_tracks');
          }

          case 'get_multiple_albums': {
            const args = this.validateArgs<MultipleAlbumsArgs>(request.params.arguments, ['ids']);
            const result = await this.albumsHandler.getMultipleAlbums(args);
            return formatToolResponse(result, 'get_multiple_albums');
          }

          case 'get_track': {
            const args = this.validateArgs<TrackArgs>(request.params.arguments, ['id']);
            const result = await this.tracksHandler.getTrack(args);
            return formatToolResponse(result, 'get_track');
          }

          case 'get_available_genres': {
            const result = await this.tracksHandler.getAvailableGenres();
            return formatToolResponse(result, 'get_available_genres');
          }

          case 'get_new_releases': {
            const args = this.validateArgs<NewReleasesArgs>(request.params.arguments || {}, []);
            const result = await this.albumsHandler.getNewReleases(args);
            return formatToolResponse(result, 'get_new_releases');
          }

          case 'get_recommendations': {
            const args = this.validateArgs<RecommendationsArgs>(request.params.arguments || {}, []);
            const result = await this.tracksHandler.getRecommendations(args);
            return formatToolResponse(result, 'get_recommendations');
          }

          case 'get_user_top_tracks': {
            const args = this.validateArgs<UserTopTracksArgs>(request.params.arguments || {}, []);
            const result = await this.tracksHandler.getUserTopTracks(args);
            return formatToolResponse(result, 'get_user_top_tracks');
          }

          case 'get_audiobook': {
            const args = this.validateArgs<AudiobookArgs>(request.params.arguments, ['id']);
            const result = await this.audiobooksHandler.getAudiobook(args);
            return formatToolResponse(result, 'get_audiobook');
          }

          case 'get_multiple_audiobooks': {
            const args = this.validateArgs<MultipleAudiobooksArgs>(request.params.arguments, ['ids']);
            const result = await this.audiobooksHandler.getMultipleAudiobooks(args);
            return formatToolResponse(result, 'get_multiple_audiobooks');
          }

          case 'get_audiobook_chapters': {
            const args = this.validateArgs<AudiobookChaptersArgs>(request.params.arguments, ['id']);
            const result = await this.audiobooksHandler.getAudiobookChapters(args);
            return formatToolResponse(result, 'get_audiobook_chapters');
          }

          case 'get_show': {
            const args = this.validateArgs<ShowArgs>(request.params.arguments, ['id']);
            const result = await this.showsHandler.getShow(args);
            return formatToolResponse(result, 'get_show');
          }

          case 'get_show_episodes': {
            const args = this.validateArgs<ShowEpisodesArgs>(request.params.arguments, ['id']);
            const result = await this.showsHandler.getShowEpisodes(args);
            return formatToolResponse(result, 'get_show_episodes');
          }

          case 'get_playlist': {
            const args = this.validateArgs<PlaylistArgs>(request.params.arguments, ['id']);
            const result = await this.playlistsHandler.getPlaylist(args);
            return formatToolResponse(result, 'get_playlist');
          }

          case 'get_playlist_tracks': {
            const args = this.validateArgs<PlaylistTracksArgs>(request.params.arguments, ['id']);
            const result = await this.playlistsHandler.getPlaylistTracks(args);
            return formatToolResponse(result, 'get_playlist_tracks');
          }

          case 'get_playlist_items': {
            const args = this.validateArgs<PlaylistItemsArgs>(request.params.arguments, ['id']);
            const result = await this.playlistsHandler.getPlaylistItems(args);
            return formatToolResponse(result, 'get_playlist_items');
          }

          case 'modify_playlist': {
            const args = this.validateArgs<ModifyPlaylistArgs>(request.params.arguments, ['id']);
            const result = await this.playlistsHandler.modifyPlaylist(args);
            return formatToolResponse(result, 'modify_playlist');
          }

          case 'add_tracks_to_playlist': {
            const args = this.validateArgs<AddTracksToPlaylistArgs>(request.params.arguments, ['id', 'uris']);
            const result = await this.playlistsHandler.addTracksToPlaylist(args);
            return formatToolResponse(result, 'add_tracks_to_playlist');
          }

          case 'remove_tracks_from_playlist': {
            const args = this.validateArgs<RemoveTracksFromPlaylistArgs>(request.params.arguments, ['id', 'tracks']);
            const result = await this.playlistsHandler.removeTracksFromPlaylist(args);
            return formatToolResponse(result, 'remove_tracks_from_playlist');
          }

          case 'get_current_user_playlists': {
            const args = this.validateArgs<GetCurrentUserPlaylistsArgs>(request.params.arguments || {}, []);
            const result = await this.playlistsHandler.getCurrentUserPlaylists(args);
            return formatToolResponse(result, 'get_current_user_playlists');
          }

          case 'create_playlist': {
            const args = this.validateArgs<CreatePlaylistArgs>(request.params.arguments, ['name']);
            const result = await this.playlistsHandler.createPlaylist(args);
            return formatToolResponse(result, 'create_playlist');
          }

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error) {
        // Return error as tool response instead of throwing, to avoid JSON-RPC error code issues
        const errorMessage = error instanceof McpError 
          ? error.message 
          : error instanceof Error 
            ? error.message 
            : String(error);
        
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: errorMessage }) }],
          isError: true
        };
      }
    });
  }

  private setupHttpServer() {
    this.httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      // Set keep-alive and timeout headers to improve connection stability
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Keep-Alive', 'timeout=30');
      
      try {
        // Log raw URL before parsing to debug query param issues
        logger.debug({ rawUrl: req.url, host: req.headers.host }, 'Raw request URL before parsing');
        const url = new URL(req.url!, `http://${req.headers.host}`);
        logger.debug({ parsedUrl: url.toString(), search: url.search, searchParams: Object.fromEntries(url.searchParams.entries()) }, 'Parsed URL');

        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
        res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate');

        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        // Health check endpoint
        if (url.pathname === '/health') {
          try {
            // Check session-specific auth if sessionId provided
            const sessionId = url.searchParams.get('sessionId') || undefined;
            const authStatus = await this.authManager.getAuthStatus(sessionId);
            const stats = this.authManager.getStats();

            // Check ngrok forwarding status
            const ngrokStatus = await this.getNgrokStatus();

            const healthData = {
              status: 'ok',
              name: packageJson.name,
              version: packageJson.version,
              message: 'Spotify MCP Server is running (Multi-user mode)',
              timestamp: new Date().toISOString(),
              auth: authStatus,
              stats: stats,
              forwarding: ngrokStatus
            };

            // Check if request wants JSON (from curl, fetch, etc.) or HTML (browser)
            const acceptHeader = req.headers['accept'] || '';
            if (acceptHeader.includes('text/html')) {
              // Return formatted HTML for browser viewing
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`
                <!DOCTYPE html>
                <html>
                  <head>
                    <title>Spotify MCP Server - Health Check</title>
                  </head>
                  <body>
                    <pre>${JSON.stringify(healthData, null, 2)}</pre>
                  </body>
                </html>
              `);
            } else {
              // Return plain JSON for API clients
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(healthData, null, 2));
            }
          } catch (error) {
            const errorData = {
              status: 'ok',
              message: 'Spotify MCP Server is running',
              timestamp: new Date().toISOString(),
              auth: {
                status: 'Error checking auth',
                tokenValid: false,
                hasUserToken: false,
                hasRefreshToken: false,
                hasAuthCode: false,
                hasClientCredentials: false,
                error: error instanceof Error ? error.message : String(error)
              },
              forwarding: {
                status: 'Error checking forwarding',
                enabled: false,
                error: error instanceof Error ? error.message : String(error)
              }
            };

            const acceptHeader = req.headers['accept'] || '';
            if (acceptHeader.includes('text/html')) {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`
                <!DOCTYPE html>
                <html>
                  <head>
                    <title>Spotify MCP Server - Health Check</title>
                  </head>
                  <body>
                    <pre>${JSON.stringify(errorData, null, 2)}</pre>
                  </body>
                </html>
              `);
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(errorData, null, 2));
            }
          }
          return;
        }

        // Favicon endpoint
        if (url.pathname === '/favicon.ico' || url.pathname === '/favicon.png') {
          try {
            const faviconPath = this.getFaviconPath();
            const faviconData = fs.readFileSync(faviconPath);
            res.writeHead(200, {
              'Content-Type': 'image/png',
              'Cache-Control': 'public, max-age=31536000',
            });
            res.end(faviconData);
          } catch (error) {
            logger.error({ error }, 'Failed to serve favicon');
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Favicon not found');
          }
          return;
        }

        // OAuth authorization endpoint
        if (url.pathname === '/auth') {
          if (req.method === 'GET') {
            // Support both sessionId (our custom flow) and standard OAuth parameters (MCP Inspector)
            const sessionId = url.searchParams.get('sessionId');
            const clientId = url.searchParams.get('client_id');
            const redirectUri = url.searchParams.get('redirect_uri');
            const state = url.searchParams.get('state');
            const responseType = url.searchParams.get('response_type');
            const scope = url.searchParams.get('scope');
            const codeChallenge = url.searchParams.get('code_challenge');
            const codeChallengeMethod = url.searchParams.get('code_challenge_method');

            // If standard OAuth parameters are provided (client_id + redirect_uri)
            if (clientId && redirectUri && state) {
              // Validate the registered client
              const client = this.clientRegistrationManager.getClient(clientId);
              if (!client) {
                res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(`
                  <html>
                    <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #191414; color: white;">
                      <h1>❌ Invalid Client</h1>
                      <p>The provided client_id is not registered.</p>
                    </body>
                  </html>
                `);
                return;
              }

              // Validate redirect_uri matches registered URIs
              if (!client.redirect_uris.includes(redirectUri)) {
                res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(`
                  <html>
                    <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #191414; color: white;">
                      <h1>❌ Invalid Redirect URI</h1>
                      <p>The provided redirect_uri does not match any registered URIs for this client.</p>
                    </body>
                  </html>
                `);
                return;
              }

              // Generate a session ID for this client if not provided
              const generatedSessionId = sessionId || `client_${clientId}_${state}`;

              // Store the client authorization request
              this.authManager.storePendingOAuthRequest(generatedSessionId, {
                clientId,
                redirectUri,
                state,
                responseType: responseType || 'code',
                scope: scope || client.scope || '',
                codeChallenge,
                codeChallengeMethod
              });

              // Show authorization page
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(this.authManager.getAuthorizationPageHtml(generatedSessionId));
              return;
            }

            // Legacy flow: sessionId parameter
            if (sessionId) {
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(this.authManager.getAuthorizationPageHtml(sessionId));
              return;
            }

            // No valid parameters provided
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
              <html>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #191414; color: white;">
                  <h1>❌ Missing Parameters</h1>
                  <p>Please provide either:</p>
                  <ul style="text-align: left; max-width: 400px; margin: 20px auto;">
                    <li><strong>Legacy:</strong> sessionId query parameter</li>
                    <li><strong>OAuth 2.0:</strong> client_id, redirect_uri, and state parameters</li>
                  </ul>
                  <p style="color: #999;">Example: /auth?client_id=...&redirect_uri=...&state=...</p>
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
            const state = url.searchParams.get('state');
            const error = url.searchParams.get('error');

            if (error) {
              res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`
                <html>
                  <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #191414; color: white;">
                    <h1 style="color: #e22134;">❌ Authorization Error</h1>
                    <p>Error: ${error}</p>
                  </body>
                </html>
              `);
              return;
            }

            if (!code || !state) {
              res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`
                <html>
                  <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #191414; color: white;">
                    <h1>❌ Invalid Callback</h1>
                    <p>Missing authorization code or state parameter.</p>
                  </body>
                </html>
              `);
              return;
            }

            try {
              const tokenResult = await this.authManager.exchangeCodeForTokens(code, state);

              // Check if this was initiated by a registered OAuth client
              const oauthRequest = this.authManager.getPendingOAuthRequest(tokenResult.sessionId);

              if (oauthRequest) {
                // Clear the pending request
                this.authManager.clearPendingOAuthRequest(tokenResult.sessionId);

                // Generate our own authorization code for the client (preserve PKCE challenge)
                const authCode = this.authManager.generateAuthorizationCode(
                  tokenResult.sessionId,
                  oauthRequest.clientId,
                  oauthRequest.redirectUri,
                  oauthRequest.codeChallenge,
                  oauthRequest.codeChallengeMethod
                );

                // Redirect back to the registered client's redirect_uri with our authorization code
                const redirectUrl = new URL(oauthRequest.redirectUri);
                redirectUrl.searchParams.set('code', authCode);
                redirectUrl.searchParams.set('state', oauthRequest.state);

                logger.info({
                  sessionId: tokenResult.sessionId,
                  clientId: oauthRequest.clientId,
                  redirectUri: oauthRequest.redirectUri
                }, 'Redirecting to registered client callback with authorization code');

                res.writeHead(302, { 'Location': redirectUrl.toString() });
                res.end();
                return;
              }

              // Legacy flow: show success page
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`
                <html>
                  <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #191414; color: white;">
                    <h1 style="color: #1db954;">✅ Authorization Successful!</h1>
                    <p>Your Spotify account has been linked to this session.</p>
                    <p>You can now close this window and use the MCP server.</p>
                    <div style="background: #282828; padding: 20px; border-radius: 10px; margin: 20px 0;">
                      <p><strong>Session ID:</strong> ${tokenResult.sessionId.substring(0, 16)}...</p>
                      <p><strong>User ID:</strong> ${tokenResult.userId}</p>
                      <p><strong>Expires in:</strong> ${Math.floor(tokenResult.expiresIn / 60)} minutes</p>
                    </div>
                    <p style="margin-top: 20px;">
                      <a href="/health?sessionId=${tokenResult.sessionId}" style="background: #1db954; color: white; padding: 12px 24px; text-decoration: none; border-radius: 25px; font-weight: bold;">Check Session Status</a>
                    </p>
                  </body>
                </html>
              `);

            } catch (error) {
              res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(`
                <html>
                  <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #191414; color: white;">
                    <h1 style="color: #e22134;">❌ Token Exchange Error</h1>
                    <p>Failed to exchange authorization code for access token.</p>
                    <p style="color: #999;">Error: ${error instanceof Error ? error.message : String(error)}</p>
                    <p><a href="/auth" style="color: #1db954;">Try again</a></p>
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

        // Session revoke endpoint
        if (url.pathname === '/revoke') {
          if (req.method === 'POST') {
            const sessionId = url.searchParams.get('sessionId');
            if (!sessionId) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing sessionId parameter' }));
              return;
            }

            try {
              this.authManager.revokeSession(sessionId);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: true,
                message: 'Session authorization revoked successfully'
              }));
            } catch (error) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                success: false,
                error: 'Failed to revoke session',
                details: error instanceof Error ? error.message : String(error)
              }));
            }
          } else {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
          }
          return;
        }

        // Resource metadata endpoint (MCP Authorization Discovery)
        if (url.pathname === '/mcp-metadata') {
          const baseUrl = this.getBaseUrl(req);
          const metadata = {
            authorizationEndpoint: `${baseUrl}/authorize`,
            tokenEndpoint: `${baseUrl}/token`,
            resourceServer: baseUrl,
            mcpEndpoint: `${baseUrl}/mcp`,
            scopes: this.REQUIRED_SCOPES_ARRAY
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(metadata, null, 2));
          return;
        }

        // Well-known metadata endpoint (fallback discovery per MCP spec)
        if (url.pathname === '/.well-known/oauth-protected-resource') {
          const baseUrl = this.getBaseUrl(req);
          const metadata = {
            authorizationServer: `${baseUrl}/authorize`,
            tokenEndpoint: `${baseUrl}/token`,
            resourceMetadata: `${baseUrl}/mcp-metadata`,
            mcpEndpoint: `${baseUrl}/mcp`
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(metadata, null, 2));
          return;
        }

        // OAuth 2.0 Authorization Server Metadata (RFC 8414)
        if (url.pathname === '/.well-known/oauth-authorization-server') {
          const baseUrl = this.getBaseUrl(req);

          // OAuth 2.1 / RFC 8414 Authorization Server Metadata
          const metadata = {
            issuer: baseUrl,
            authorization_endpoint: `${baseUrl}/auth`,
            token_endpoint: `${baseUrl}/token`,
            registration_endpoint: `${baseUrl}/register`,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            code_challenge_methods_supported: ['S256'],
            scopes_supported: this.REQUIRED_SCOPES_ARRAY,
            token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic']
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(metadata, null, 2));
          return;
        }

        // Authorization server metadata endpoint
        if (url.pathname === '/authorize') {
          if (req.method === 'GET') {
            const baseUrl = this.getBaseUrl(req);

            // OAuth 2.1 / OpenID Connect Discovery metadata
            const metadata = {
              issuer: baseUrl,
              authorization_endpoint: `${baseUrl}/auth`,
              token_endpoint: `${baseUrl}/token`,
              registration_endpoint: `${baseUrl}/register`,
              response_types_supported: ['code'],
              grant_types_supported: ['authorization_code', 'refresh_token'],
              code_challenge_methods_supported: ['S256'],
              scopes_supported: this.REQUIRED_SCOPES_ARRAY,
              token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic']
            };

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(metadata, null, 2));
          } else {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed. Use GET.' }));
          }
          return;
        }

        // Dynamic Client Registration endpoint (RFC 7591)
        if (url.pathname === '/register') {
          if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => {
              body += chunk.toString();
            });

            req.on('end', () => {
              try {
                const registrationRequest = JSON.parse(body);
                const baseUrl = this.getBaseUrl(req);

                // Register the client
                const registrationResponse = this.clientRegistrationManager.registerClient(registrationRequest);

                // Add registration_client_uri
                registrationResponse.registration_client_uri = `${baseUrl}/register/${registrationResponse.client_id}`;

                res.writeHead(201, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(registrationResponse, null, 2));

                logger.info({
                  clientId: registrationResponse.client_id,
                  clientName: registrationRequest.client_name
                }, 'Client registered via dynamic registration');
              } catch (error) {
                logger.error({ error }, 'Client registration error');
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  error: 'invalid_client_metadata',
                  error_description: error instanceof Error ? error.message : 'Invalid request body'
                }));
              }
            });
          } else {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
          }
          return;
        }

        // Token endpoint (for OAuth token exchange)
        if (url.pathname === '/token') {
          if (req.method === 'POST') {
            logger.info('Token endpoint POST request received');
            let body = '';
            let requestComplete = false;

            // Set a timeout for reading the request body
            const timeout = setTimeout(() => {
              if (!requestComplete) {
                logger.error('Token request body read timeout');
                if (!res.headersSent) {
                  res.writeHead(408, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({
                    error: 'request_timeout',
                    error_description: 'Request body read timeout'
                  }));
                }
              }
            }, 10000); // 10 second timeout

            req.on('error', (error) => {
              clearTimeout(timeout);
              logger.error({ error }, 'Error reading token request body');
              if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  error: 'server_error',
                  error_description: 'Failed to read request body'
                }));
              }
            });

            req.on('data', chunk => {
              body += chunk.toString();
              logger.debug({ chunkSize: chunk.length, totalSize: body.length }, 'Received data chunk');
            });

            req.on('end', async () => {
              clearTimeout(timeout);
              requestComplete = true;
              logger.info('Token request body fully received');
              try {
                logger.info({
                  rawBody: body.substring(0, 300),
                  bodyLength: body.length,
                  contentType: req.headers['content-type'],
                  authorization: req.headers['authorization'] ? 'Present' : 'Missing'
                }, 'Token exchange raw request');

                let grantType, code, redirectUri, clientId, clientSecret;

                // Check for client credentials in Authorization header (HTTP Basic Auth)
                const authHeader = req.headers['authorization'];
                if (authHeader && authHeader.startsWith('Basic ')) {
                  try {
                    const base64Credentials = authHeader.substring(6);
                    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
                    const [headerClientId, headerClientSecret] = credentials.split(':');
                    clientId = headerClientId;
                    clientSecret = headerClientSecret;
                    logger.info({ clientId, hasSecret: !!clientSecret }, 'Client credentials from Authorization header');
                  } catch (error) {
                    logger.error({ error }, 'Failed to parse Authorization header');
                  }
                }

                // Try to parse as JSON first, then fall back to form-urlencoded
                const contentType = req.headers['content-type'] || '';
                if (contentType.includes('application/json')) {
                  const jsonBody = JSON.parse(body);
                  grantType = jsonBody.grant_type;
                  code = jsonBody.code;
                  redirectUri = jsonBody.redirect_uri;
                  // Override with body values if present
                  clientId = jsonBody.client_id || clientId;
                  clientSecret = jsonBody.client_secret || clientSecret;
                } else {
                  // Parse as form-urlencoded
                  const params = new URLSearchParams(body);

                  // Log all params for debugging
                  const allParams: Record<string, string> = {};
                  for (const [key, value] of params.entries()) {
                    allParams[key] = value.substring(0, 50); // Truncate for logging
                  }
                  logger.info({ allParams }, 'All URL parameters');

                  grantType = params.get('grant_type');
                  code = params.get('code');
                  redirectUri = params.get('redirect_uri');
                  // Use body values if present, otherwise use header values
                  clientId = params.get('client_id') || clientId;
                  clientSecret = params.get('client_secret') || clientSecret;

                  // Try alternative parameter names if standard ones don't work
                  if (!clientId) {
                    clientId = params.get('clientId') || params.get('client-id');
                  }
                  if (!clientSecret) {
                    clientSecret = params.get('clientSecret') || params.get('client-secret');
                  }
                  if (!redirectUri) {
                    redirectUri = params.get('redirectUri') || params.get('redirect-uri');
                  }
                }

                logger.info({
                  grantType,
                  clientId,
                  hasCode: !!code,
                  hasRedirectUri: !!redirectUri,
                  hasClientSecret: !!clientSecret,
                  contentType
                }, 'Token exchange request parsed');

                // Validate grant type
                if (grantType !== 'authorization_code') {
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({
                    error: 'unsupported_grant_type',
                    error_description: 'Only authorization_code grant type is supported'
                  }));
                  return;
                }

                // Validate required parameters
                if (!code || !redirectUri || !clientId) {
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({
                    error: 'invalid_request',
                    error_description: 'Missing required parameters: code, redirect_uri, client_id'
                  }));
                  return;
                }

                // Extract code_verifier for PKCE validation (need to parse params first)
                let codeVerifier: string | null = null;
                if (contentType.includes('application/json')) {
                  const jsonBody = JSON.parse(body);
                  codeVerifier = jsonBody.code_verifier || null;
                } else {
                  const params = new URLSearchParams(body);
                  codeVerifier = params.get('code_verifier');
                }
                const hasPKCE = !!codeVerifier;
                
                // Get the client first to check if it exists
                const client = this.clientRegistrationManager.getClient(clientId);
                if (!client) {
                  logger.error({ clientId }, 'Client not found');
                  res.writeHead(401, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({
                    error: 'invalid_client',
                    error_description: 'Client not found'
                  }));
                  return;
                }
                
                // Validate client credentials - support both PKCE and client_secret
                logger.info({
                  clientId,
                  hasClientSecret: !!clientSecret,
                  clientSecretLength: clientSecret?.length || 0,
                  hasPKCE,
                  codeVerifierLength: codeVerifier?.length || 0
                }, 'Validating client credentials');
                
                let clientValid = false;
                
                // If PKCE is provided, validate it first
                if (hasPKCE) {
                  // Peek at authorization code to get PKCE challenge data without consuming it
                  const authCodeData = this.authManager.peekAuthorizationCode(code, clientId, redirectUri);
                  if (authCodeData && authCodeData.codeChallenge && authCodeData.codeChallengeMethod) {
                    // Validate PKCE: code_verifier should hash to code_challenge
                    const crypto = await import('crypto');
                    let calculatedChallenge: string;
                    if (authCodeData.codeChallengeMethod === 'S256') {
                      calculatedChallenge = crypto.createHash('sha256')
                        .update(codeVerifier!)
                        .digest('base64url');
                    } else if (authCodeData.codeChallengeMethod === 'plain') {
                      calculatedChallenge = codeVerifier!;
                    } else {
                      logger.error({ method: authCodeData.codeChallengeMethod }, 'Unsupported code challenge method');
                      res.writeHead(400, { 'Content-Type': 'application/json' });
                      res.end(JSON.stringify({
                        error: 'invalid_request',
                        error_description: 'Unsupported code challenge method'
                      }));
                      return;
                    }
                    
                    if (calculatedChallenge === authCodeData.codeChallenge) {
                      clientValid = true;
                      logger.info({ clientId }, 'PKCE validation successful');
                    } else {
                      logger.warn({ 
                        clientId,
                        calculatedLength: calculatedChallenge.length,
                        storedLength: authCodeData.codeChallenge.length
                      }, 'PKCE validation failed - code_verifier does not match code_challenge');
                    }
                  } else {
                    logger.warn({ 
                      clientId,
                      hasAuthCode: !!authCodeData,
                      hasCodeChallenge: !!authCodeData?.codeChallenge
                    }, 'PKCE requested but no code_challenge found in authorization code');
                  }
                }
                
                // Fall back to client_secret validation if PKCE not used or failed
                if (!clientValid) {
                  if (!clientSecret) {
                    logger.error({
                      clientId,
                      hasPKCE,
                      tokenEndpointAuthMethod: client.token_endpoint_auth_method
                    }, 'Client secret required but not provided (PKCE validation failed or not used)');
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                      error: 'invalid_client',
                      error_description: 'Client secret required or PKCE validation failed'
                    }));
                    return;
                  }
                  
                  clientValid = this.clientRegistrationManager.validateClient(clientId, clientSecret);
                  if (!clientValid) {
                    logger.error({
                      clientId,
                      hasClientSecret: !!clientSecret
                    }, 'Client validation failed - returning invalid_client error');
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                      error: 'invalid_client',
                      error_description: 'Invalid client credentials'
                    }));
                    return;
                  }
                }

                // Client is already retrieved above, use it for redirect_uri validation

                // Validate redirect_uri
                if (!client.redirect_uris.includes(redirectUri)) {
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({
                    error: 'invalid_grant',
                    error_description: 'Invalid redirect_uri'
                  }));
                  return;
                }

                // Validate and consume the authorization code
                const sessionId = this.authManager.validateAuthorizationCode(code, clientId, redirectUri);

                if (!sessionId) {
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({
                    error: 'invalid_grant',
                    error_description: 'Authorization code is invalid, expired, or has already been used'
                  }));
                  return;
                }

                // Get the access token for this session
                const accessToken = await this.authManager.getAccessToken(sessionId);
                const authStatus = await this.authManager.getAuthStatus(sessionId);

                // Calculate expires_in from expiresInMinutes
                const expiresIn = authStatus.expiresInMinutes
                  ? authStatus.expiresInMinutes * 60
                  : 3600;

                // Get refresh token from stored token (needed for MCP clients to refresh tokens)
                const storedToken = this.authManager.getTokenBySession(sessionId);
                const refreshToken = storedToken?.refreshToken || null;

                // Build token response (OAuth 2.0 compliant)
                const tokenResponse: {
                  access_token: string;
                  token_type: string;
                  expires_in: number;
                  scope: string;
                  refresh_token?: string;
                  session_id?: string; // MCP-specific: include sessionId for client to use when connecting
                } = {
                  access_token: accessToken,
                  token_type: 'Bearer',
                  expires_in: expiresIn,
                  scope: client.scope || this.REQUIRED_SCOPES,
                  session_id: sessionId // Include sessionId so client knows what to use for /mcp connection
                };

                // Include refresh_token if available (required for MCP clients)
                if (refreshToken) {
                  tokenResponse.refresh_token = refreshToken;
                } else {
                  logger.warn({ sessionId, clientId }, 'No refresh token available for session');
                }

                logger.info({
                  clientId,
                  sessionId,
                  expiresIn: tokenResponse.expires_in,
                  hasRefreshToken: !!refreshToken
                }, 'Token exchange successful');

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(tokenResponse));

              } catch (error) {
                logger.error({ error }, 'Token exchange error');
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                  error: 'server_error',
                  error_description: error instanceof Error ? error.message : 'Internal server error'
                }));
              }
            });
          } else {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
          }
          return;
        }

        // MCP endpoint with Authorization Discovery
        if (url.pathname === '/mcp') {
          if (req.method === 'GET') {
            logger.info({ 
              url: req.url, 
              method: req.method,
              headers: Object.keys(req.headers),
              hasAuthHeader: !!req.headers['authorization'],
              authHeaderPrefix: req.headers['authorization']?.substring(0, 20) || 'none',
              queryParams: Object.fromEntries(url.searchParams.entries())
            }, 'MCP connection attempt received');
            
            // Check if client provided a sessionId
            let clientSessionId = url.searchParams.get('sessionId');
            logger.info({ sessionId: clientSessionId, url: req.url, allParams: Object.fromEntries(url.searchParams.entries()) }, 'SessionId from query params');

            // Check for Authorization header (Bearer token)
            const authHeader = req.headers['authorization'];
            if (!clientSessionId && authHeader && authHeader.startsWith('Bearer ')) {
              // Extract access token from Bearer header
              const accessToken = authHeader.substring(7);
              logger.info({ tokenPrefix: accessToken.substring(0, 20) + '...' }, 'Attempting to find session by Bearer token');

              // Find session by access token
              const allSessions = this.authManager.getAllSessions();
              logger.info({ sessionCount: allSessions.length }, 'Searching sessions for matching token');
              
              for (const session of allSessions) {
                try {
                  const sessionToken = await this.authManager.getAccessToken(session.sessionId);
                  if (sessionToken === accessToken) {
                    clientSessionId = session.sessionId;
                    logger.info({ sessionId: clientSessionId }, 'Session identified from Bearer token');
                    break;
                  }
                } catch (error) {
                  // Skip sessions that fail to get token
                  logger.debug({ sessionId: session.sessionId, error }, 'Failed to get token for session, skipping');
                  continue;
                }
              }
              
              if (!clientSessionId) {
                logger.warn({ tokenPrefix: accessToken.substring(0, 20) + '...', sessionCount: allSessions.length }, 
                  'Bearer token provided but no matching session found');
              }
            }

            const hasValidAuth = !!clientSessionId;

            // If no authentication provided, return 401 with discovery headers
            if (!hasValidAuth) {
              const baseUrl = this.getBaseUrl(req);

              // Return 401 with WWW-Authenticate header containing resource_metadata and scope (RFC 6750 Section 3)
              res.writeHead(401, {
                'Content-Type': 'application/json',
                'WWW-Authenticate': `Bearer realm="${baseUrl}", resource_metadata="${baseUrl}/mcp-metadata", scope="${this.REQUIRED_SCOPES}"`
              });
              res.end(JSON.stringify({
                error: 'unauthorized',
                error_description: 'Authentication required. Please obtain authorization.',
                authorization_endpoint: `${baseUrl}/auth`,
                resource_metadata: `${baseUrl}/mcp-metadata`,
                documentation: 'https://github.com/modelcontextprotocol/specification'
              }));

              logger.info('MCP request rejected: No authentication provided (401 with discovery headers)');
              return;
            }

            // Check if session has valid token (if sessionId provided)
            if (clientSessionId) {
              const authStatus = await this.getCachedAuthStatus(clientSessionId);
              if (!authStatus.authenticated) {
                const baseUrl = this.getBaseUrl(req);

                res.writeHead(401, {
                  'Content-Type': 'application/json',
                  'WWW-Authenticate': `Bearer realm="${baseUrl}", resource_metadata="${baseUrl}/mcp-metadata", scope="${this.REQUIRED_SCOPES}", error="invalid_token"`
                });
                res.end(JSON.stringify({
                  error: 'invalid_token',
                  error_description: 'Session token is invalid or expired. Please re-authorize.',
                  authorization_endpoint: `${baseUrl}/auth?sessionId=${clientSessionId}`,
                  session_id: clientSessionId
                }));

                logger.info({ sessionId: clientSessionId }, 'MCP request rejected: Invalid or expired token');
                return;
              }
            }

            // Initialize SSE connection (authenticated)
            const transport = new SSEServerTransport('/mcp', res);

            // Always store transport by its auto-generated sessionId (for POST handling)
            this.transports.set(transport.sessionId, transport);

            // If client provided a custom sessionId, create a mapping and also store by custom ID
            if (clientSessionId) {
              this.sessionIdMapping.set(transport.sessionId, clientSessionId);
              this.transports.set(clientSessionId, transport);
              logger.info({ 
                customSessionId: clientSessionId, 
                transportSessionId: transport.sessionId,
                totalTransports: this.transports.size
              }, 'Transport stored with custom sessionId mapping');
            }

            const displaySessionId = clientSessionId || transport.sessionId;
            logger.info({ sessionId: displaySessionId, transportSessionId: transport.sessionId, isCustomSession: !!clientSessionId }, 
              'New MCP session connected (authenticated)'
            );

            // Set up transport event handlers
            transport.onclose = () => {
              this.transports.delete(transport.sessionId);
              if (clientSessionId) {
                this.transports.delete(clientSessionId);
                this.sessionIdMapping.delete(transport.sessionId);
                this.authStatusCache.delete(clientSessionId); // Clear cached auth status
              }
              logger.info({ sessionId: displaySessionId }, 'MCP session disconnected');
            };

            transport.onerror = (error) => {
              logger.error({ error, sessionId: displaySessionId }, 'SSE Error');
            };

            // Connect the MCP server to this transport
            await this.server.connect(transport);

          } else if (req.method === 'POST') {
            // Handle incoming messages
            const transportSessionId = url.searchParams.get('sessionId');

            logger.info({ 
              transportSessionId, 
              transportSessionIdLength: transportSessionId?.length,
              availableTransports: Array.from(this.transports.keys()),
              url: req.url
            }, 'MCP POST request received');

            if (!transportSessionId) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Missing sessionId parameter' }));
              return;
            }

            // Try to find transport by exact match first
            let transport = this.transports.get(transportSessionId);
            
            // If not found, try to find by looking up via sessionId mapping (reverse lookup)
            if (!transport) {
              // Check if any transport has this sessionId mapped to it
              for (const [transportId, mappedSessionId] of this.sessionIdMapping.entries()) {
                if (mappedSessionId === transportSessionId) {
                  logger.info({ 
                    providedSessionId: transportSessionId, 
                    foundTransportId: transportId 
                  }, 'Found transport via sessionId mapping');
                  transport = this.transports.get(transportId);
                  break;
                }
              }
            }
            
            // If still not found, try to find by partial match (in case sessionId was truncated in GET)
            if (!transport && transportSessionId.length > 20) {
              // Try matching against mapped sessionIds
              for (const [transportId, mappedSessionId] of this.sessionIdMapping.entries()) {
                if (mappedSessionId && (
                  mappedSessionId.startsWith(transportSessionId) || 
                  transportSessionId.startsWith(mappedSessionId.substring(0, transportSessionId.length))
                )) {
                  logger.warn({ 
                    providedSessionId: transportSessionId, 
                    matchedSessionId: mappedSessionId,
                    transportId: transportId
                  }, 'Using partial sessionId match via mapping');
                  transport = this.transports.get(transportId);
                  break;
                }
              }
              
              // Also try direct key matching
              if (!transport) {
                const partialMatch = Array.from(this.transports.keys()).find(key => 
                  key.startsWith(transportSessionId) || transportSessionId.startsWith(key.substring(0, transportSessionId.length))
                );
                if (partialMatch) {
                  logger.warn({ 
                    providedSessionId: transportSessionId, 
                    matchedSessionId: partialMatch 
                  }, 'Using partial sessionId match on transport key');
                  transport = this.transports.get(partialMatch);
                }
              }
            }

            if (!transport) {
              logger.error({ 
                transportSessionId, 
                availableTransports: Array.from(this.transports.keys()).map(k => k.substring(0, 50) + '...')
              }, 'Session not found for POST request');
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ 
                error: 'Session not found',
                provided_session_id: transportSessionId,
                hint: 'Make sure you use the full sessionId from the token response'
              }));
              return;
            }

            logger.info({ transportSessionId }, 'Transport found for POST request');

            // Resolve to custom sessionId if one was provided during connection
            const customSessionId = this.sessionIdMapping.get(transportSessionId);
            const sessionId = customSessionId || transportSessionId;
            
            logger.info({ transportSessionId, customSessionId, resolvedSessionId: sessionId }, 'Resolved sessionId for POST request');

            // Verify session still has valid auth for POST requests
            const authStatus = await this.getCachedAuthStatus(sessionId);
            if (!authStatus.authenticated) {
              const baseUrl = this.getBaseUrl(req);

              res.writeHead(401, {
                'Content-Type': 'application/json',
                'WWW-Authenticate': `Bearer realm="${baseUrl}", resource_metadata="${baseUrl}/mcp-metadata", scope="${this.REQUIRED_SCOPES}", error="invalid_token"`
              });
              res.end(JSON.stringify({
                error: 'invalid_token',
                error_description: 'Session token is invalid or expired. Please re-authorize.',
                authorization_endpoint: `${baseUrl}/auth?sessionId=${sessionId}`
              }));

              logger.info({ sessionId }, 'MCP POST request rejected: Invalid or expired token');
              return;
            }

            // Set current session ID for this request (use custom ID if available)
            this.currentSessionId = sessionId;

            await transport.handlePostMessage(req, res);

            // Clear session ID after request
            this.currentSessionId = undefined;
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
        logger.error({ error }, 'HTTP Server Error');
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
  }

  async listen(port: number = 3000, host: string = '127.0.0.1') {
    return new Promise<void>((resolve, reject) => {
      // Set server timeouts to prevent connection issues
      this.httpServer.timeout = 120000; // 2 minutes
      this.httpServer.keepAliveTimeout = 65000; // 65 seconds (> typical load balancer timeout)
      this.httpServer.headersTimeout = 66000; // slightly more than keepAliveTimeout
      
      this.httpServer.listen(port, host, () => {
        logger.info({ host, port }, 'Spotify MCP HTTP server running (Multi-user mode with Authorization Discovery)');
        logger.info('MCP Endpoints:');
        logger.info('  GET  /mcp                      - MCP SSE connection (requires auth)');
        logger.info('  POST /mcp                      - MCP message endpoint');
        logger.info('');
        logger.info('Authorization Discovery (MCP Spec):');
        logger.info('  GET  /mcp-metadata                           - Resource metadata endpoint');
        logger.info('  GET  /.well-known/oauth-protected-resource   - Protected resource metadata');
        logger.info('  GET  /.well-known/oauth-authorization-server - OAuth 2.0 AS metadata (RFC 8414)');
        logger.info('  GET  /authorize                              - Authorization server metadata');
        logger.info('  POST /register                               - Dynamic client registration (RFC 7591)');
        logger.info('  POST /token                                  - Token endpoint (not implemented)');
        logger.info('');
        logger.info('OAuth Flow:');
        logger.info('  GET  /auth?sessionId=<id>      - Start Spotify OAuth for session');
        logger.info('  GET  /callback                 - Spotify OAuth callback');
        logger.info('  POST /revoke?sessionId=<id>    - Revoke session authorization');
        logger.info('');
        logger.info('Utility:');
        logger.info('  GET  /health?sessionId=<id>    - Health check (session-specific)');
        logger.info('  GET  /favicon.ico              - Favicon image');
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

    // Close auth manager
    this.authManager.close();

    // Close client registration manager
    this.clientRegistrationManager.close();
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
  server.listen(port, host).catch(error => logger.error({ error }, 'Failed to start server'));
}

export default SpotifyHttpServer;