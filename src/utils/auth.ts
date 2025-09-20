import axios from 'axios';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { TokenInfo } from '../types/common.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

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
    SPOTIFY_REFRESH_TOKEN: process.env.SPOTIFY_REFRESH_TOKEN,
    SPOTIFY_AUTH_CODE: process.env.SPOTIFY_AUTH_CODE,
    SPOTIFY_TOKEN_EXPIRES_AT: process.env.SPOTIFY_TOKEN_EXPIRES_AT,
    HTTP_HOST: process.env.HTTP_HOST,
    HTTP_PORT: process.env.HTTP_PORT
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
  private storedRefreshToken: string | null = null;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly scopes: string[];

  constructor(redirectUri?: string) {
    const env = getEnvVars();
    this.clientId = env.SPOTIFY_CLIENT_ID!;
    this.clientSecret = env.SPOTIFY_CLIENT_SECRET!;

    // Build redirect URI from environment variables if not provided
    if (redirectUri) {
      this.redirectUri = redirectUri;
    } else {
      const host = process.env.HTTP_HOST || '127.0.0.1';
      const port = process.env.HTTP_PORT || '3001';
      this.redirectUri = `http://${host}:${port}/callback`;
    }
    this.scopes = [
      'playlist-read-private',
      'playlist-read-collaborative',
      'user-read-private',
      'user-top-read',
      'playlist-modify-public',
      'playlist-modify-private'
    ];
  }

  async getAccessToken(): Promise<string> {
    // Get fresh environment variables each time
    const env = getEnvVars();

    // If we have a user token, validate it first
    if (env.SPOTIFY_USER_ACCESS_TOKEN) {
      // Test if the user token is still valid (pass token explicitly to avoid circular dependency)
      const validation = await this.validateToken(env.SPOTIFY_USER_ACCESS_TOKEN);

      if (validation.valid) {
        // Token is valid, return it
        return env.SPOTIFY_USER_ACCESS_TOKEN;
      } else {
        // Token is expired/invalid, try to refresh it
        if (env.SPOTIFY_REFRESH_TOKEN) {
          try {
            console.error('🔄 User token expired, refreshing...');
            const newToken = await this.refreshAccessToken();
            return newToken;
          } catch (refreshError) {
            console.error('❌ Failed to refresh user token:', refreshError);
            // Fall through to client credentials as fallback
          }
        } else {
          console.error('⚠️ User token expired and no refresh token available');
          // Fall through to client credentials as fallback
        }
      }
    }

    // Check if we have a valid client credentials token cached
    if (this.tokenInfo && Date.now() < this.tokenInfo.expiresAt) {
      return this.tokenInfo.accessToken;
    }

    // Get new client credentials token as fallback
    try {
      console.error('🔑 Getting new client credentials token...');
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

  /**
   * Get the current redirect URI being used
   */
  getRedirectUri(): string {
    return this.redirectUri;
  }

  /**
   * Generate authorization URL for OAuth flow
   */
  getAuthorizationUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      scope: this.scopes.join(' '),
      show_dialog: 'true'
    });

    if (state) {
      params.append('state', state);
    }

    return `https://accounts.spotify.com/authorize?${params.toString()}`;
  }

  /**
   * Generate authorization page HTML
   */
  getAuthorizationPageHtml(): string {
    const authUrl = this.getAuthorizationUrl();
    return `
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Spotify Authorization</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #191414; color: white; }
            .container { max-width: 500px; margin: 0 auto; }
            .auth-btn { background: #1db954; color: white; padding: 15px 30px; text-decoration: none; border-radius: 25px; font-weight: bold; font-size: 16px; display: inline-block; margin: 20px 0; }
            .auth-btn:hover { background: #1ed760; }
            .info { background: #282828; padding: 20px; border-radius: 10px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🎵 Spotify Authorization</h1>
            <p>Click the button below to authorize the MCP server to access your Spotify data:</p>
            <a href="${authUrl}" class="auth-btn">Authorize Spotify Access</a>
            <div class="info">
              <h3>Required Permissions:</h3>
              <ul style="text-align: left;">
                <li>Read your private playlists</li>
                <li>Read your collaborative playlists</li>
                <li>Access your profile information</li>
                <li>View your top tracks and artists</li>
                <li>Modify your playlists</li>
              </ul>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * Exchange authorization code for access token and refresh token
   */
  async exchangeCodeForTokens(code: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    try {
      const response = await axios.post('https://accounts.spotify.com/api/token',
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: code,
          redirect_uri: this.redirectUri,
          client_id: this.clientId,
          client_secret: this.clientSecret
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      const { access_token, refresh_token, expires_in } = response.data;

      if (!access_token || !refresh_token) {
        throw new Error('Invalid response from Spotify token endpoint');
      }

      // Store tokens
      this.tokenInfo = {
        accessToken: access_token,
        expiresAt: Date.now() + (expires_in * 1000)
      };
      this.storedRefreshToken = refresh_token;

      // Calculate expiry timestamp
      const expiryTimestamp = Date.now() + (expires_in * 1000);
      const expiryDate = new Date(expiryTimestamp);

      // Update .env file
      await this.updateEnvFile({
        SPOTIFY_USER_ACCESS_TOKEN: access_token,
        SPOTIFY_REFRESH_TOKEN: refresh_token,
        SPOTIFY_AUTH_CODE: code,
        SPOTIFY_TOKEN_EXPIRES_AT: expiryTimestamp.toString()
      });

      return {
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresIn: expires_in
      };

    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorData = error.response?.data;
        const errorMessage = errorData?.error_description || errorData?.error || error.message;
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to exchange authorization code: ${errorMessage}`
        );
      }
      throw error;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(): Promise<string> {
    const env = getEnvVars();
    const refreshToken = this.storedRefreshToken || env.SPOTIFY_REFRESH_TOKEN;

    if (!refreshToken) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'No refresh token available. Please complete OAuth authorization flow first.'
      );
    }

    try {
      const response = await axios.post('https://accounts.spotify.com/api/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: this.clientId,
          client_secret: this.clientSecret
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );

      const { access_token, refresh_token, expires_in } = response.data;

      // Update token info
      this.tokenInfo = {
        accessToken: access_token,
        expiresAt: Date.now() + (expires_in * 1000)
      };

      // Update refresh token if a new one was provided
      if (refresh_token) {
        this.storedRefreshToken = refresh_token;
      }

      // Calculate expiry timestamp
      const expiryTimestamp = Date.now() + (expires_in * 1000);

      // Update .env file
      const updateData: Record<string, string> = {
        SPOTIFY_USER_ACCESS_TOKEN: access_token,
        SPOTIFY_TOKEN_EXPIRES_AT: expiryTimestamp.toString()
      };
      if (refresh_token) {
        updateData.SPOTIFY_REFRESH_TOKEN = refresh_token;
      }
      await this.updateEnvFile(updateData);

      console.error('✅ Access token refreshed successfully');
      return access_token;

    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorData = error.response?.data;
        const errorMessage = errorData?.error_description || errorData?.error || error.message;
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to refresh access token: ${errorMessage}`
        );
      }
      throw error;
    }
  }

  /**
   * Legacy method for backward compatibility
   */
  async refreshToken(): Promise<boolean> {
    try {
      await this.refreshAccessToken();
      return true;
    } catch (error) {
      console.error('Failed to refresh token:', error);
      return false;
    }
  }

  /**
   * Update .env file with new values
   */
  private async updateEnvFile(updates: Record<string, string>): Promise<void> {
    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';

    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    // Update or add each key-value pair
    for (const [key, value] of Object.entries(updates)) {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      const newLine = `${key}="${value}"`;

      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, newLine);
      } else {
        envContent += envContent.endsWith('\n') ? newLine + '\n' : '\n' + newLine + '\n';
      }

      // Update process.env
      process.env[key] = value;
    }

    fs.writeFileSync(envPath, envContent);
  }

  /**
   * Validate current token by making a test API call
   */
  async validateToken(token?: string): Promise<{ valid: boolean; user?: any; error?: string }> {
    const testToken = token || (await this.getAccessToken());

    try {
      const response = await axios.get('https://api.spotify.com/v1/me', {
        headers: {
          'Authorization': `Bearer ${testToken}`
        }
      });

      return {
        valid: true,
        user: {
          id: response.data.id,
          displayName: response.data.display_name,
          email: response.data.email,
          country: response.data.country
        }
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        return {
          valid: false,
          error: error.response?.data?.error?.message || error.message
        };
      }
      return {
        valid: false,
        error: 'Unknown error occurred'
      };
    }
  }

  /**
   * Get auth status for health checks
   */
  async getAuthStatus(): Promise<{
    status: string;
    tokenValid: boolean;
    hasUserToken: boolean;
    hasRefreshToken: boolean;
    hasAuthCode: boolean;
    hasClientCredentials: boolean;
    details: any;
  }> {
    const env = getEnvVars();
    const hasUserToken = !!env.SPOTIFY_USER_ACCESS_TOKEN;
    const hasRefreshToken = !!env.SPOTIFY_REFRESH_TOKEN;
    const hasAuthCode = !!env.SPOTIFY_AUTH_CODE;
    const hasClientCredentials = !!this.clientId && !!this.clientSecret;

    let tokenValid = false;
    let authStatus = 'No user token';
    let authDetails: any = {};

    if (hasUserToken) {
      const validation = await this.validateToken(env.SPOTIFY_USER_ACCESS_TOKEN);
      tokenValid = validation.valid;

      if (tokenValid) {
        authStatus = 'User token active';

        // Add expiry information if available
        let expiryInfo = {};
        if (env.SPOTIFY_TOKEN_EXPIRES_AT) {
          const expiryTimestamp = parseInt(env.SPOTIFY_TOKEN_EXPIRES_AT);
          const expiryDate = new Date(expiryTimestamp);
          const now = Date.now();
          const timeUntilExpiry = expiryTimestamp - now;
          const minutesUntilExpiry = Math.floor(timeUntilExpiry / (1000 * 60));

          expiryInfo = {
            expiresAt: expiryDate.toISOString(),
            expiresAtLocal: expiryDate.toLocaleString(),
            expiresInMinutes: minutesUntilExpiry,
            isExpired: timeUntilExpiry <= 0
          };
        }

        authDetails = {
          userToken: env.SPOTIFY_USER_ACCESS_TOKEN?.substring(0, 20) + '...',
          redirectUri: this.redirectUri,
          ...validation.user,
          ...expiryInfo
        };
      } else {
        authStatus = 'User token invalid/expired';
        authDetails = { error: validation.error };

        // Try to refresh if we have a refresh token
        if (hasRefreshToken) {
          try {
            await this.refreshAccessToken();
            // Re-read env vars to get the refreshed token
            const refreshedEnv = getEnvVars();
            const newValidation = await this.validateToken(refreshedEnv.SPOTIFY_USER_ACCESS_TOKEN);
            if (newValidation.valid) {
              tokenValid = true;
              authStatus = 'Token refreshed successfully';

              // Add expiry information for refreshed token
              let refreshedExpiryInfo = {};
              if (refreshedEnv.SPOTIFY_TOKEN_EXPIRES_AT) {
                const expiryTimestamp = parseInt(refreshedEnv.SPOTIFY_TOKEN_EXPIRES_AT);
                const expiryDate = new Date(expiryTimestamp);
                const now = Date.now();
                const timeUntilExpiry = expiryTimestamp - now;
                const minutesUntilExpiry = Math.floor(timeUntilExpiry / (1000 * 60));

                refreshedExpiryInfo = {
                  expiresAt: expiryDate.toISOString(),
                  expiresAtLocal: expiryDate.toLocaleString(),
                  expiresInMinutes: minutesUntilExpiry,
                  isExpired: timeUntilExpiry <= 0
                };
              }

              authDetails = {
                userToken: refreshedEnv.SPOTIFY_USER_ACCESS_TOKEN?.substring(0, 20) + '...',
                redirectUri: this.redirectUri,
                ...newValidation.user,
                ...refreshedExpiryInfo
              };
            }
          } catch (refreshError) {
            authDetails.refreshError = refreshError instanceof Error ? refreshError.message : String(refreshError);
          }
        }
      }
    } else if (hasAuthCode) {
      authStatus = 'Auth code available but no token';
      authDetails = { authCode: env.SPOTIFY_AUTH_CODE?.substring(0, 20) + '...' };
    } else if (hasClientCredentials) {
      authStatus = 'Ready for authorization';
      authDetails = {
        clientId: this.clientId.substring(0, 8) + '...',
        redirectUri: this.redirectUri
      };
    } else {
      authStatus = 'Missing client credentials';
      authDetails = { error: 'SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET required' };
    }

    return {
      status: authStatus,
      tokenValid,
      hasUserToken,
      hasRefreshToken,
      hasAuthCode,
      hasClientCredentials,
      details: authDetails
    };
  }
}