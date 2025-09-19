import axios from 'axios';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { TokenInfo } from '../types/common.js';

const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_USER_ACCESS_TOKEN = process.env.SPOTIFY_USER_ACCESS_TOKEN;

if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
  throw new Error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET environment variables are required');
}

console.error('Using Spotify User Access token:', SPOTIFY_USER_ACCESS_TOKEN ? 'Token provided' : 'No token');
// Note: Spotify access tokens are opaque tokens, not JWTs, so we don't validate format

export class AuthManager {
  private tokenInfo: TokenInfo | null = null;

  async getAccessToken(): Promise<string> {
    // If user token is provided, use it for user data access
    if (SPOTIFY_USER_ACCESS_TOKEN) {
      return SPOTIFY_USER_ACCESS_TOKEN;
    }

    // Check if we have a valid token
    if (this.tokenInfo && Date.now() < this.tokenInfo.expiresAt) {
      return this.tokenInfo.accessToken;
    }

    // Get new token
    try {
      const response = await axios.post('https://accounts.spotify.com/api/token', 
        new URLSearchParams({
          grant_type: 'client_credentials'
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(SPOTIFY_CLIENT_ID + ':' + SPOTIFY_CLIENT_SECRET).toString('base64')
          }
        }
      );

      this.tokenInfo = {
        accessToken: response.data.access_token,
        expiresAt: Date.now() + (response.data.expires_in * 1000)
      };

      return this.tokenInfo.accessToken;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to get Spotify access token: ${error.response?.data?.error ?? error.message}`
        );
      }
      throw error;
    }
  }
}
