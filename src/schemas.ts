/**
 * Simplified Output Schemas for MCP Tools
 * 
 * These schemas define only ESSENTIAL fields to avoid validation issues.
 * We intentionally omit extraneous Spotify API fields.
 */

/**
 * Strip response data to only include fields defined in schema.
 * This ensures responses match the schema exactly (no extra properties).
 */
export function stripToSchema(data: unknown, schema: Record<string, unknown>): unknown {
  if (data === null || data === undefined) return data;
  if (!schema) return data;

  const schemaObj = schema as Record<string, any>;

  // Handle anyOf (e.g., images can be array or null)
  if (schemaObj.anyOf) {
    if (data === null) return null;
    for (const variant of schemaObj.anyOf as Array<Record<string, any>>) {
      if (variant.type === 'null' && data === null) return null;
      if (variant.type === 'array' && Array.isArray(data)) {
        return stripToSchema(data, variant);
      }
      if (variant.type === 'object' && typeof data === 'object' && !Array.isArray(data)) {
        return stripToSchema(data, variant);
      }
    }
    return data;
  }

  // Handle arrays
  if (schemaObj.type === 'array' && Array.isArray(data)) {
    if (schemaObj.items) {
      return (data as unknown[]).map((item) => stripToSchema(item, schemaObj.items));
    }
    return data;
  }

  // Handle objects
  const schemaType = schemaObj.type;
  const isObjectType = schemaType === 'object' || 
    (Array.isArray(schemaType) && schemaType.includes('object'));
  
  if (isObjectType) {
    if (typeof data !== 'object' || Array.isArray(data)) return data;
    
    const properties = schemaObj.properties as Record<string, any> | undefined;
    if (!properties) return data;

    const result: Record<string, unknown> = {};
    const dataObj = data as Record<string, unknown>;
    for (const key of Object.keys(properties)) {
      if (key in dataObj) {
        result[key] = stripToSchema(dataObj[key], properties[key]);
      }
    }
    return result;
  }

  // Primitives pass through
  return data;
}

// Reusable simplified sub-schemas
const simpleImage = {
  type: 'object',
  properties: {
    url: { type: 'string' },
    height: { type: 'number' },
    width: { type: 'number' }
  }
};

const simpleArtist = {
  type: 'object',  
  properties: {
    id: { type: 'string' },  
    name: { type: 'string' },
    uri: { type: 'string' },
    images: { type: 'array', items: simpleImage },
    popularity: { type: 'number' }
  }  
};  

const simpleAlbum = {
  type: 'object',  
  properties: {
    id: { type: 'string' },  
    name: { type: 'string' },
    uri: { type: 'string' },
    images: { type: 'array', items: simpleImage },
    total_tracks: { type: 'number' },
    release_date: { type: 'string' },
  }  
};  

const simpleTrack = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    artists: { type: 'array', items: simpleArtist },
    album: simpleAlbum,
    duration_ms: { type: 'number' },
    uri: { type: 'string' },
    images: { type: 'array', items: simpleImage }
  },
  required: ['id', 'name', 'uri']
};

const simpleOwner = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    display_name: { type: ['string', 'null'] }
  }
};

const paginationFields = {
  href: { type: 'string' },
  limit: { type: 'number' },
  next: { type: ['string', 'null'] },
  offset: { type: 'number' },
  previous: { type: ['string', 'null'] },
  total: { type: 'number' }
};

export const outputSchemas: Record<string, any> = {
  // === Auth Tools ===
  get_session_info: {
    type: 'object',
    properties: {
      sessionId: { type: 'string' },
      authUrl: { type: 'string' },
      status: { type: 'string' },
      authenticated: { type: 'boolean' },
      userId: { type: ['string', 'null'] },
      spotifyUserId: { type: ['string', 'null'] },
      displayName: { type: ['string', 'null'] },
      email: { type: ['string', 'null'] },
      expiresAt: { type: ['string', 'null'] },
      expiresInMinutes: { type: ['number', 'null'] }
    },
    required: ['sessionId', 'authUrl', 'status', 'authenticated']
  },

  get_access_token: {
    type: 'object',
    properties: {
      token: { type: 'string' }
    },
    required: ['token']
  },

  // === Search ===
  // Supports: track, album, artist, playlist (specified in inputSchema enum)
  // Only ONE of these will be present based on search type
  search: {
    type: 'object',
    properties: {
      tracks: {
        type: 'object',
        properties: {
          href: { type: 'string' },
          limit: { type: 'number' },
          next: { type: ['string', 'null'] },
          offset: { type: 'number' },
          previous: { type: ['string', 'null'] },
          total: { type: 'number' },
          items: { type: 'array', items: simpleTrack }
        }
      },
      albums: {
        type: 'object',
        properties: {
          href: { type: 'string' },
          limit: { type: 'number' },
          next: { type: ['string', 'null'] },
          offset: { type: 'number' },
          previous: { type: ['string', 'null'] },
          total: { type: 'number' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                artists: { type: 'array', items: simpleArtist },
                images: { type: 'array', items: simpleImage },
                uri: { type: 'string' }
              }
            }
          }
        }
      },
      artists: {
        type: 'object',
        properties: {
          href: { type: 'string' },
          limit: { type: 'number' },
          next: { type: ['string', 'null'] },
          offset: { type: 'number' },
          previous: { type: ['string', 'null'] },
          total: { type: 'number' },
          items: { type: 'array', items: simpleArtist }
        }
      },
      playlists: {
        type: 'object',
        properties: {
          href: { type: 'string' },
          limit: { type: 'number' },
          next: { type: ['string', 'null'] },
          offset: { type: 'number' },
          previous: { type: ['string', 'null'] },
          total: { type: 'number' },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                description: { type: ['string', 'null'] },
                owner: simpleOwner,
                images: {
                  anyOf: [
                    { type: 'array', items: simpleImage },
                    { type: 'null' }
                  ]
                },
                uri: { type: 'string' }
              }
            }
          }
        }
      }
    }
  },

  // === Artist Tools ===
  get_artist: simpleArtist,

  get_multiple_artists: {
    type: 'object',
    properties: {
      artists: { type: 'array', items: simpleArtist }
    },
    required: ['artists']
  },

  get_artist_top_tracks: {
    type: 'object',
    properties: {
      tracks: { type: 'array', items: simpleTrack }
    },
    required: ['tracks']
  },

  get_artist_related_artists: {
    type: 'object',
    properties: {
      artists: { type: 'array', items: simpleArtist }
    },
    required: ['artists']
  },

  get_artist_albums: {
    type: 'object',
    properties: {
      ...paginationFields,
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            artists: { type: 'array', items: simpleArtist },
            images: { type: 'array', items: simpleImage },
            uri: { type: 'string' }
          }
        }
      }
    },
    required: ['items']
  },

  // === Album Tools ===
  get_album: simpleAlbum,

  get_album_tracks: {
    type: 'object',
    properties: {
      ...paginationFields,
      items: { type: 'array', items: simpleTrack }
    },
    required: ['items']
  },

  get_multiple_albums: {
    type: 'object',
    properties: {
      albums: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            artists: { type: 'array', items: simpleArtist },
            images: { type: 'array', items: simpleImage },
            uri: { type: 'string' }
          }
        }
      }
    },
    required: ['albums']
  },

  // === Track Tools ===
  get_track: simpleTrack,

  get_available_genres: {
    type: 'object',
    properties: {
      genres: { type: 'array', items: { type: 'string' } }
    },
    required: ['genres']
  },

  get_new_releases: {
    type: 'object',
    properties: {
      albums: {
        type: 'object',
        properties: {
          ...paginationFields,
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                artists: { type: 'array', items: simpleArtist },
                images: { type: 'array', items: simpleImage },
                uri: { type: 'string' }
              }
            }
          }
        }
      }
    },
    required: ['albums']
  },

  get_recommendations: {
    type: 'object',
    properties: {
      tracks: { type: 'array', items: simpleTrack },
      seeds: { type: 'array', items: { type: 'object' } }
    },
    required: ['tracks', 'seeds']
  },

  get_user_top_tracks: {
    type: 'object',
    properties: {
      ...paginationFields,
      items: { type: 'array', items: simpleTrack }
    },
    required: ['items']
  },

  // === Audiobook Tools ===
  get_audiobook: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      authors: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } } },
      narrators: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } } },
      total_chapters: { type: 'number' },
      images: { type: 'array', items: simpleImage },
      uri: { type: 'string' }
    },
    required: ['id', 'name', 'uri']
  },

  get_multiple_audiobooks: {
    type: 'object',
    properties: {
      audiobooks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            authors: { type: 'array', items: { type: 'object' } },
            narrators: { type: 'array', items: { type: 'object' } },
            total_chapters: { type: 'number' },
            images: { type: 'array', items: simpleImage },
            uri: { type: 'string' }
          }
        }
      }
    },
    required: ['audiobooks']
  },

  get_audiobook_chapters: {
    type: 'object',
    properties: {
      ...paginationFields,
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            chapter_number: { type: 'number' },
            duration_ms: { type: 'number' },
            uri: { type: 'string' }
          }
        }
      }
    },
    required: ['items']
  },

  // === Playlist Tools ===
  get_playlist: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      description: { type: ['string', 'null'] },
      owner: simpleOwner,
      tracks: {
        type: 'object',
        properties: {
          total: { type: 'number' }
        }
      },
      images: {
        anyOf: [
          { type: 'array', items: simpleImage },
          { type: 'null' }
        ]
      },
      uri: { type: 'string' }
    },
    required: ['id', 'name', 'uri']
  },

  get_playlist_tracks: {
    type: 'object',
    properties: {
      ...paginationFields,
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            added_at: { type: 'string' },
            track: {
              type: ['object', 'null'],
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                artists: { type: 'array', items: simpleArtist },
                album: simpleAlbum,
                duration_ms: { type: 'number' },
                uri: { type: 'string' }
              }
            }
          }
        }
      }
    },
    required: ['items']
  },

  get_playlist_items: {
    type: 'object',
    properties: {
      ...paginationFields,
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            added_at: { type: 'string' },
            track: { type: ['object', 'null'] },
            episode: { type: ['object', 'null'] }
          }
        }
      }
    },
    required: ['items']
  },

  modify_playlist: {
    type: 'object',
    properties: {
      snapshot_id: { type: 'string' }
    },
    required: ['snapshot_id']
  },

  add_tracks_to_playlist: {
    type: 'object',
    properties: {
      snapshot_id: { type: 'string' }
    },
    required: ['snapshot_id']
  },

  remove_tracks_from_playlist: {
    type: 'object',
    properties: {
      snapshot_id: { type: 'string' }
    },
    required: ['snapshot_id']
  },

  get_current_user_playlists: {
    type: 'object',
    properties: {
      ...paginationFields,
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: ['string', 'null'] },
            owner: simpleOwner,
            tracks: {
              type: 'object',
              properties: {
                total: { type: 'number' }
              }
            },
            images: {
              anyOf: [
                { type: 'array', items: simpleImage },
                { type: 'null' }
              ]
            },
            uri: { type: 'string' }
          }
        }
      }
    },
    required: ['items']
  },

  get_featured_playlists: {
    type: 'object',
    properties: {
      message: { type: 'string' },
      playlists: {
        type: 'object',
        properties: {
          ...paginationFields,
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                description: { type: ['string', 'null'] },
                images: {
                  anyOf: [
                    { type: 'array', items: simpleImage },
                    { type: 'null' }
                  ]
                },
                uri: { type: 'string' }
              }
            }
          }
        }
      }
    },
    required: ['playlists']
  },

  get_category_playlists: {
    type: 'object',
    properties: {
      playlists: {
        type: 'object',
        properties: {
          ...paginationFields,
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                description: { type: ['string', 'null'] },
                images: {
                  anyOf: [
                    { type: 'array', items: simpleImage },
                    { type: 'null' }
                  ]
                },
                uri: { type: 'string' }
              }
            }
          }
        }
      }
    },
    required: ['playlists']
  }
};
