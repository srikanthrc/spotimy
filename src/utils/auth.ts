import axios from 'axios';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { TokenInfo } from '../types/common.js';
import fs from 'fs';
import path from 'path';

// Don't cache these at startup - read them fresh each time
function getEnvVars() {
  // Re-read .env file to get latest values
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const envVars: Record<string, string> = {};

    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^#][^=]*?)="?([^"]*)"?$/);
      if (match) {
        const [, key, value] = match;
        envVars[key.trim()] = value.trim();
      }
    });

    // Update process.env with fresh values
    Object.assign(process.env, envVars);
  }

  return {
    SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
    SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
    SPOTIFY_USER_ACCESS_TOKEN: process.env.SPOTIFY_USER_ACCESS_TOKEN,
    SPOTIFY_AUTH_CODE: process.env.SPOTIFY_AUTH_CODE
  };
}

// Initial validation - but we'll re-check dynamically
const initialEnv = getEnvVars();
if (!initialEnv.SPOTIFY_CLIENT_ID || !initialEnv.SPOTIFY_CLIENT_SECRET) {
  throw new Error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET environment variables are required');
}

console.error('Using Spotify User Access token:', initialEnv.SPOTIFY_USER_ACCESS_TOKEN ? 'Token provided' : 'No token');
// Note: Spotify access tokens are opaque tokens, not JWTs, so we don't validate format

export class AuthManager {
  private tokenInfo: TokenInfo | null = null;

  async getAccessToken(): Promise<string> {
    // Get fresh environment variables each time
    const env = getEnvVars();

    // If user token is provided, use it for user data access
    if (env.SPOTIFY_USER_ACCESS_TOKEN) {
      return env.SPOTIFY_USER_ACCESS_TOKEN;
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
            'Authorization': 'Basic ' + Buffer.from(env.SPOTIFY_CLIENT_ID + ':' + env.SPOTIFY_CLIENT_SECRET).toString('base64')
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

  async refreshToken(): Promise<boolean> {
    // Get fresh environment variables
    const env = getEnvVars();

    if (!env.SPOTIFY_AUTH_CODE) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'SPOTIFY_AUTH_CODE not found in environment variables. Please run OAuth flow first.'
      );
    }

    try {
      // Exchange auth code for access token
      const response = await axios.post('https://accounts.spotify.com/api/token',
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: env.SPOTIFY_AUTH_CODE,
          redirect_uri: 'http://127.0.0.1:8000/callback',
          client_id: env.SPOTIFY_CLIENT_ID!,
          client_secret: env.SPOTIFY_CLIENT_SECRET!
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      const newAccessToken = response.data.access_token;

      if (!newAccessToken) {
        throw new Error('No access token received');
      }

      // Update .env file with new access token
      const envPath = path.join(process.cwd(), '.env');
      const envContent = fs.readFileSync(envPath, 'utf8');
      const updatedEnv = envContent.replace(
        /SPOTIFY_USER_ACCESS_TOKEN="[^"]*"/,
        `SPOTIFY_USER_ACCESS_TOKEN="${newAccessToken}"`
      );
      fs.writeFileSync(envPath, updatedEnv);

      // Update the environment variable for current process
      process.env.SPOTIFY_USER_ACCESS_TOKEN = newAccessToken;

      console.error('✅ Token refreshed successfully');
      return true;

    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to refresh Spotify token: ${error.response?.data?.error_description ?? error.response?.data?.error ?? error.message}`
        );
      }
      throw error;
    }
  }
}
