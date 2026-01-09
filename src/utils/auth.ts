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
  private pendingOAuthRequests = new Map<string, {
    clientId: string;
    redirectUri: string;
    state: string;
    responseType: string;
    scope: string;
    codeChallenge?: string | null;
    codeChallengeMethod?: string | null;
    expiresAt: number;
  }>();
  private authorizationCodes = new Map<string, {
    sessionId: string;
    clientId: string;
    redirectUri: string;
    expiresAt: number;
    codeChallenge?: string | null;
    codeChallengeMethod?: string | null;
  }>();

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
      'playlist-modify-private',
      // Playback control scopes
      'user-read-playback-state',
      'user-modify-playback-state',
      'user-read-currently-playing',
      'user-read-recently-played'
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
   * Store pending OAuth request from dynamically registered client
   */
  storePendingOAuthRequest(sessionId: string, request: {
    clientId: string;
    redirectUri: string;
    state: string;
    responseType: string;
    scope: string;
    codeChallenge?: string | null;
    codeChallengeMethod?: string | null;
  }): void {
    this.pendingOAuthRequests.set(sessionId, {
      ...request,
      expiresAt: Date.now() + 10 * 60 * 1000  // 10 minutes
    });

    logger.info({
      sessionId,
      clientId: request.clientId,
      redirectUri: request.redirectUri
    }, 'Stored pending OAuth request for registered client');
  }

  /**
   * Get pending OAuth request for a session
   */
  getPendingOAuthRequest(sessionId: string) {
    return this.pendingOAuthRequests.get(sessionId);
  }

  /**
   * Clear pending OAuth request for a session
   */
  clearPendingOAuthRequest(sessionId: string): void {
    this.pendingOAuthRequests.delete(sessionId);
  }

  /**
   * Generate and store an authorization code for a registered client
   */
  generateAuthorizationCode(
    sessionId: string, 
    clientId: string, 
    redirectUri: string,
    codeChallenge?: string | null,
    codeChallengeMethod?: string | null
  ): string {
    const code = crypto.randomBytes(32).toString('base64url');

    this.authorizationCodes.set(code, {
      sessionId,
      clientId,
      redirectUri,
      expiresAt: Date.now() + 10 * 60 * 1000,  // 10 minutes
      codeChallenge,
      codeChallengeMethod
    });

    logger.info({
      code: code.substring(0, 20) + '...',
      sessionId,
      clientId,
      hasCodeChallenge: !!codeChallenge
    }, 'Generated authorization code for registered client');

    return code;
  }

  /**
   * Get authorization code data without consuming it (for PKCE validation)
   */
  peekAuthorizationCode(code: string, clientId: string, redirectUri: string): {
    sessionId: string;
    codeChallenge?: string | null;
    codeChallengeMethod?: string | null;
  } | null {
    const authCode = this.authorizationCodes.get(code);

    if (!authCode) {
      return null;
    }

    // Check expiration
    if (Date.now() > authCode.expiresAt) {
      return null;
    }

    // Validate client and redirect URI
    if (authCode.clientId !== clientId || authCode.redirectUri !== redirectUri) {
      return null;
    }

    return {
      sessionId: authCode.sessionId,
      codeChallenge: authCode.codeChallenge,
      codeChallengeMethod: authCode.codeChallengeMethod
    };
  }

  /**
   * Validate and consume authorization code
   */
  validateAuthorizationCode(code: string, clientId: string, redirectUri: string): string | null {
    const authCode = this.authorizationCodes.get(code);

    if (!authCode) {
      logger.warn({ code: code.substring(0, 20) + '...' }, 'Authorization code not found');
      return null;
    }

    // Check expiration
    if (Date.now() > authCode.expiresAt) {
      this.authorizationCodes.delete(code);
      logger.warn({ code: code.substring(0, 20) + '...' }, 'Authorization code expired');
      return null;
    }

    // Validate client and redirect URI
    if (authCode.clientId !== clientId || authCode.redirectUri !== redirectUri) {
      logger.warn({
        code: code.substring(0, 20) + '...',
        expectedClient: authCode.clientId,
        providedClient: clientId
      }, 'Authorization code validation failed');
      return null;
    }

    // Code is valid - consume it (one-time use)
    this.authorizationCodes.delete(code);

    logger.info({
      sessionId: authCode.sessionId,
      clientId
    }, 'Authorization code validated and consumed');

    return authCode.sessionId;
  }

  /**
   * Get authorization page HTML for a specific session
   * Single-step consent screen - shows permissions and the app requesting access
   */
  getAuthorizationPageHtml(sessionId: string): string {
    const authUrl = this.getAuthorizationUrl(sessionId);
    // Use APP_DOMAIN env var if set (e.g., "dreamer.com"), otherwise fall back to redirect URI hostname
    const appDomain = process.env.APP_DOMAIN || new URL(this.redirectUri).hostname;
    const appName = process.env.APP_NAME || 'Spotimy';
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connect to Spotify · \${appName}</title>
  <link rel="icon" type="image/png" href="/favicon.png">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #fafafa;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    
    .card {
      background: white;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 8px 30px rgba(0,0,0,0.05);
      max-width: 400px;
      width: 100%;
      overflow: hidden;
    }
    
    .header {
      padding: 32px 32px 24px;
      text-align: center;
      border-bottom: 1px solid #f0f0f0;
    }
    
    .logos {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      margin-bottom: 24px;
    }
    
    .logo-circle {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .logo-spotimy {
      background: linear-gradient(135deg, #1db954 0%, #1ed760 100%);
      box-shadow: 0 2px 8px rgba(29, 185, 84, 0.3);
    }
    
    .logo-spotimy svg { width: 24px; height: 24px; fill: white; }
    
    .logo-spotify {
      background: #000;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    }
    
    .logo-spotify svg { width: 26px; height: 26px; fill: #1db954; }
    
    .arrow { color: #ccc; font-size: 18px; }
    
    h1 {
      font-size: 20px;
      font-weight: 600;
      color: #1a1a1a;
      margin-bottom: 6px;
    }
    
    .subtitle {
      font-size: 14px;
      color: #666;
    }
    
    .domain-badge {
      display: inline-block;
      background: #e8f5e9;
      color: #2e7d32;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 500;
      margin-top: 12px;
    }
    
    .permissions {
      padding: 24px 32px;
    }
    
    .permissions-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #888;
      margin-bottom: 16px;
    }
    
    .permission {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 0;
      font-size: 14px;
      color: #333;
    }
    
    .permission:not(:last-child) {
      border-bottom: 1px solid #f5f5f5;
    }
    
    .permission-icon {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: #f5f5f5;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      flex-shrink: 0;
    }
    
    .actions {
      padding: 24px 32px;
      background: #fafafa;
      border-top: 1px solid #f0f0f0;
    }
    
    .btn {
      display: block;
      width: 100%;
      padding: 14px 20px;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 500;
      text-align: center;
      text-decoration: none;
      cursor: pointer;
      transition: all 0.15s ease;
      border: none;
    }
    
    .btn-primary {
      background: #1db954;
      color: white;
    }
    
    .btn-primary:hover {
      background: #1ed760;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(29, 185, 84, 0.3);
    }
    
    .footer {
      padding: 16px 32px 24px;
      background: #fafafa;
      text-align: center;
    }
    
    .session-id {
      font-size: 11px;
      color: #999;
      font-family: 'SF Mono', Monaco, Consolas, monospace;
    }
    
    .cancel-link {
      display: block;
      margin-top: 12px;
      font-size: 13px;
      color: #888;
      text-decoration: none;
    }
    
    .cancel-link:hover {
      color: #666;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="logos">
        <div class="logo-circle logo-spotimy">
          <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>
        </div>
        <span class="arrow">→</span>
        <div class="logo-circle logo-spotify">
          <svg viewBox="0 0 24 24"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
        </div>
      </div>
      <h1>Connect to Spotify</h1>
      <p class="subtitle">Grant access to your Spotify account</p>
      <div class="domain-badge">🔒 ${appDomain}</div>
    </div>
    
    <div class="permissions">
      <div class="permissions-label">This will allow ${appName} to</div>
      <div class="permission">
        <div class="permission-icon">📋</div>
        <span>View and manage your playlists</span>
      </div>
      <div class="permission">
        <div class="permission-icon">👤</div>
        <span>Access your profile information</span>
      </div>
      <div class="permission">
        <div class="permission-icon">🎵</div>
        <span>See your top tracks and artists</span>
      </div>
      <div class="permission">
        <div class="permission-icon">▶️</div>
        <span>Control playback on your devices</span>
      </div>
    </div>
    
    <div class="actions">
      <a href="${authUrl}" class="btn btn-primary">Connect with Spotify</a>
    </div>
    
    <div class="footer">
      <span class="session-id">Session ${sessionId.substring(0, 8)}</span>
      <a href="javascript:window.close()" class="cancel-link">Cancel</a>
    </div>
  </div>
</body>
</html>`;
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
   * Refresh token for OAuth client (called from /token endpoint with grant_type=refresh_token)
   * 
   * This method:
   * 1. Finds the user associated with the refresh token
   * 2. Calls Spotify to get new tokens
   * 3. Updates the stored tokens
   * 4. Returns the new tokens for the OAuth client
   */
  async refreshTokenForClient(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    sessionId?: string;
  }> {
    // Find the user by refresh token
    const existingToken = this.tokenStore.findUserByRefreshToken(refreshToken);
    
    if (!existingToken) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        'Invalid refresh token - token not found'
      );
    }

    logger.info({ userId: existingToken.userId }, 'Refreshing token for OAuth client');

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

      // Use new refresh token if Spotify provides one, otherwise keep the old one
      const finalRefreshToken = new_refresh_token || refreshToken;

      // Update token in store
      const updatedToken: UserToken = {
        ...existingToken,
        accessToken: access_token,
        refreshToken: finalRefreshToken,
        expiresAt,
        updatedAt: Date.now()
      };

      this.tokenStore.saveUserToken(updatedToken);

      // Get session ID for this user (if exists)
      const sessions = this.tokenStore.getSessionsForUser(existingToken.userId);
      const sessionId = sessions.length > 0 ? sessions[0].sessionId : undefined;

      logger.info({ userId: existingToken.userId, sessionId }, 'Token refreshed for OAuth client');

      return {
        accessToken: access_token,
        refreshToken: finalRefreshToken,
        expiresIn: expires_in,
        sessionId
      };

    } catch (error) {
      if (axios.isAxiosError(error)) {
        const errorData = error.response?.data;
        const errorMessage = errorData?.error_description || errorData?.error || error.message;
        logger.error({ error: errorMessage, userId: existingToken.userId }, 'Failed to refresh token for client');
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
   * Get all sessions (for token lookup)
   */
  getAllSessions() {
    return this.tokenStore.getAllSessions();
  }

  /**
   * Get token by session ID (for retrieving refresh token)
   */
  getTokenBySession(sessionId: string) {
    return this.tokenStore.getTokenBySession(sessionId);
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
