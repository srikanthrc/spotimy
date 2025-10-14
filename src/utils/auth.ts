import axios from 'axios';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { TokenInfo } from '../types/common.js';
import crypto from 'crypto';
import logger from './logger.js';
import { TokenStore, UserToken } from './token-store.js';

/**
 * Multi-user authentication manager with secure token storage
 *
 * Features:
 * - Per-session OAuth authorization
 * - Secure encrypted token persistence
 * - Automatic token refresh
 * - Backward compatibility with .env tokens
 */
export class AuthManager {
  private tokenStore: TokenStore;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly scopes: string[];
  private pendingAuthStates = new Map<string, { sessionId: string; expiresAt: number }>();

  // Fallback client credentials token (for unauthenticated requests)
  private clientCredentialsToken: TokenInfo | null = null;

  constructor(dataDir?: string) {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET environment variables are required');
    }

    this.clientId = clientId;
    this.clientSecret = clientSecret;

    // Initialize token store
    this.tokenStore = new TokenStore(dataDir || process.env.TOKEN_STORE_PATH || './data');

    // Build redirect URI from environment variables
    // Allow explicit SPOTIFY_REDIRECT_URI for ngrok/production deployments
    this.redirectUri = process.env.SPOTIFY_REDIRECT_URI || (() => {
      const host = process.env.HTTP_HOST || '127.0.0.1';
      const port = process.env.HTTP_PORT || '3001';
      return `http://${host}:${port}/callback`;
    })();

    this.scopes = [
      'playlist-read-private',
      'playlist-read-collaborative',
      'user-read-private',
      'user-top-read',
      'playlist-modify-public',
      'playlist-modify-private'
    ];

    logger.info({ redirectUri: this.redirectUri }, 'AuthManager initialized with multi-user support');

    // Periodic cleanup of expired tokens
    setInterval(() => {
      this.tokenStore.cleanupExpiredTokens();
    }, 24 * 60 * 60 * 1000); // Daily cleanup
  }

  /**
   * Get access token for a specific session
   */
  async getAccessToken(sessionId?: string): Promise<string> {
    // If sessionId provided, try to get user token
    if (sessionId) {
      const token = this.tokenStore.getTokenBySession(sessionId);

      if (token) {
        // Check if token is expired
        if (Date.now() < token.expiresAt) {
          return token.accessToken;
        }

        // Token expired, try to refresh
        try {
          logger.info({ sessionId, userId: token.userId }, 'User token expired, refreshing...');
          const refreshed = await this.refreshUserToken(token.userId, token.refreshToken);
          return refreshed.accessToken;
        } catch (error) {
          logger.error({ error, sessionId, userId: token.userId }, 'Failed to refresh user token');
          // Fall through to client credentials
        }
      } else {
        logger.debug({ sessionId }, 'No user token found for session, using client credentials');
      }
    }

    // Fall back to client credentials token
    return this.getClientCredentialsToken();
  }

  /**
   * Get client credentials token (for unauthenticated requests)
   */
  private async getClientCredentialsToken(): Promise<string> {
    // Check if we have a valid cached token
    if (this.clientCredentialsToken && Date.now() < this.clientCredentialsToken.expiresAt) {
      return this.clientCredentialsToken.accessToken;
    }

    // Get new client credentials token
    try {
      logger.info('Getting new client credentials token...');
      const response = await axios.post('https://accounts.spotify.com/api/token',
        new URLSearchParams({
          grant_type: 'client_credentials'
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(this.clientId + ':' + this.clientSecret).toString('base64')
          }
        }
      );

      this.clientCredentialsToken = {
        accessToken: response.data.access_token,
        expiresAt: Date.now() + (response.data.expires_in * 1000)
      };

      return this.clientCredentialsToken.accessToken;
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
   * Generate authorization URL for OAuth flow with session binding
   */
  getAuthorizationUrl(sessionId: string): string {
    // Generate random state for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');

    // Store state with session mapping (expires in 10 minutes)
    this.pendingAuthStates.set(state, {
      sessionId,
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      scope: this.scopes.join(' '),
      state,
      show_dialog: 'true'
    });

    return `https://accounts.spotify.com/authorize?${params.toString()}`;
  }

  /**
   * Get authorization page HTML for a specific session
   */
  getAuthorizationPageHtml(sessionId: string): string {
    const authUrl = this.getAuthorizationUrl(sessionId);
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
            .session-id { font-family: monospace; color: #1db954; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🎵 Spotify Authorization</h1>
            <p>Click the button below to authorize this session to access your Spotify data:</p>
            <p class="session-id">Session: ${sessionId.substring(0, 16)}...</p>
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
   * Exchange authorization code for tokens and link to session
   */
  async exchangeCodeForTokens(code: string, state: string): Promise<{
    sessionId: string;
    userId: string;
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> {
    // Validate state and get session
    const authState = this.pendingAuthStates.get(state);
    if (!authState) {
      throw new McpError(ErrorCode.InvalidParams, 'Invalid or expired authorization state');
    }

    if (Date.now() > authState.expiresAt) {
      this.pendingAuthStates.delete(state);
      throw new McpError(ErrorCode.InvalidParams, 'Authorization state expired');
    }

    const sessionId = authState.sessionId;
    this.pendingAuthStates.delete(state);

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

      // Get user info from Spotify
      const userInfo = await this.fetchSpotifyUserInfo(access_token);

      // Generate userId from Spotify user ID
      const userId = userInfo.id;

      // Save token to store
      const expiresAt = Date.now() + (expires_in * 1000);
      const userToken: UserToken = {
        userId,
        sessionId,
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt,
        spotifyUserId: userInfo.id,
        displayName: userInfo.display_name,
        email: userInfo.email,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      this.tokenStore.saveUserToken(userToken);

      // Link session to user
      this.tokenStore.linkSession(sessionId, userId);

      logger.info({ sessionId, userId, spotifyUserId: userInfo.id }, 'User authorized successfully');

      return {
        sessionId,
        userId,
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
   * Fetch user info from Spotify API
   */
  private async fetchSpotifyUserInfo(accessToken: string): Promise<{
    id: string;
    display_name: string;
    email: string;
  }> {
    const response = await axios.get('https://api.spotify.com/v1/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    return {
      id: response.data.id,
      display_name: response.data.display_name,
      email: response.data.email
    };
  }

  /**
   * Refresh user access token
   */
  private async refreshUserToken(userId: string, refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
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

      const { access_token, refresh_token: new_refresh_token, expires_in } = response.data;
      const expiresAt = Date.now() + (expires_in * 1000);

      // Get existing token to preserve other fields
      const existingToken = this.tokenStore.getUserToken(userId);
      if (!existingToken) {
        throw new Error('User token not found');
      }

      // Update token in store
      const updatedToken: UserToken = {
        ...existingToken,
        accessToken: access_token,
        refreshToken: new_refresh_token || refreshToken, // Use new refresh token if provided
        expiresAt,
        updatedAt: Date.now()
      };

      this.tokenStore.saveUserToken(updatedToken);

      logger.info({ userId }, 'User token refreshed successfully');

      return { accessToken: access_token, expiresAt };

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
   * Validate token by making a test API call
   */
  async validateToken(token: string): Promise<{ valid: boolean; user?: any; error?: string }> {
    try {
      const response = await axios.get('https://api.spotify.com/v1/me', {
        headers: {
          'Authorization': `Bearer ${token}`
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
   * Get auth status for a specific session
   */
  async getAuthStatus(sessionId?: string): Promise<{
    status: string;
    authenticated: boolean;
    sessionId?: string;
    userId?: string;
    spotifyUserId?: string;
    displayName?: string;
    email?: string;
    expiresAt?: string;
    expiresInMinutes?: number;
  }> {
    if (!sessionId) {
      return {
        status: 'No session provided',
        authenticated: false
      };
    }

    const token = this.tokenStore.getTokenBySession(sessionId);

    if (!token) {
      return {
        status: 'Not authorized',
        authenticated: false,
        sessionId
      };
    }

    // Check if token is still valid
    const now = Date.now();
    const isExpired = now >= token.expiresAt;

    if (isExpired) {
      // Try to refresh
      try {
        await this.refreshUserToken(token.userId, token.refreshToken);
        const refreshedToken = this.tokenStore.getUserToken(token.userId);
        if (refreshedToken) {
          return {
            status: 'Authorized (token refreshed)',
            authenticated: true,
            sessionId,
            userId: refreshedToken.userId,
            spotifyUserId: refreshedToken.spotifyUserId,
            displayName: refreshedToken.displayName,
            email: refreshedToken.email,
            expiresAt: new Date(refreshedToken.expiresAt).toISOString(),
            expiresInMinutes: Math.floor((refreshedToken.expiresAt - now) / (1000 * 60))
          };
        }
      } catch (error) {
        logger.error({ error, sessionId, userId: token.userId }, 'Failed to refresh expired token');
        return {
          status: 'Token expired and refresh failed',
          authenticated: false,
          sessionId,
          userId: token.userId
        };
      }
    }

    return {
      status: 'Authorized',
      authenticated: true,
      sessionId,
      userId: token.userId,
      spotifyUserId: token.spotifyUserId,
      displayName: token.displayName,
      email: token.email,
      expiresAt: new Date(token.expiresAt).toISOString(),
      expiresInMinutes: Math.floor((token.expiresAt - now) / (1000 * 60))
    };
  }

  /**
   * Get token store statistics
   */
  getStats() {
    return this.tokenStore.getStats();
  }

  /**
   * Revoke authorization for a session
   */
  revokeSession(sessionId: string): void {
    this.tokenStore.deleteSession(sessionId);
    logger.info({ sessionId }, 'Session authorization revoked');
  }

  /**
   * Get redirect URI
   */
  getRedirectUri(): string {
    return this.redirectUri;
  }

  /**
   * Close auth manager and cleanup resources
   */
  close(): void {
    this.tokenStore.close();
  }
}
