import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';
import { createDbAdapter, isTursoConfigured, type DbAdapter } from './db-adapter.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;

export interface UserToken {
  userId: string;
  sessionId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  spotifyUserId?: string;
  displayName?: string;
  email?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionInfo {
  sessionId: string;
  userId: string;
  createdAt: number;
  lastAccessedAt: number;
}

/**
 * Secure token storage with encryption for multi-user OAuth
 *
 * Features:
 * - Pluggable database backend (Bun SQLite or Turso)
 * - AES-256-GCM encryption for sensitive fields
 * - Session-to-user mapping
 * - Automatic token expiry cleanup
 */
export class TokenStore {
  private db: DbAdapter;
  private encryptionKey: Buffer;
  private readonly dataDir: string;
  private readonly keyPath: string;

  constructor(dataDir: string = './data') {
    this.dataDir = dataDir;
    
    // Ensure data directory exists (for local key storage)
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.keyPath = path.join(dataDir, '.encryption-key');

    // Load or generate encryption key
    this.encryptionKey = this.loadOrGenerateKey();

    // Initialize database adapter (auto-selects based on environment)
    this.db = createDbAdapter('tokens', dataDir);
    this.initializeSchema();

    logger.info({ dataDir, dbType: this.db.type }, 'TokenStore initialized');
  }

  /**
   * Load existing encryption key or generate a new one
   */
  private loadOrGenerateKey(): Buffer {
    // Check for key in environment variable first
    const envKey = process.env.TOKEN_ENCRYPTION_KEY;
    if (envKey) {
      logger.info('Using encryption key from environment variable');
      return Buffer.from(envKey, 'hex');
    }

    // Check for key file
    if (fs.existsSync(this.keyPath)) {
      logger.info({ keyPath: this.keyPath }, 'Loading encryption key from file');
      const keyData = fs.readFileSync(this.keyPath, 'utf8');
      return Buffer.from(keyData, 'hex');
    }

    // Generate new key
    logger.info({ keyPath: this.keyPath }, 'Generating new encryption key');
    const key = crypto.randomBytes(32); // 256 bits
    fs.writeFileSync(this.keyPath, key.toString('hex'), { mode: 0o600 });

    logger.warn('IMPORTANT: New encryption key generated. Back up this file: ' + this.keyPath);

    return key;
  }

  /**
   * Initialize database schema
   */
  private initializeSchema(): void {
    // Create users table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        access_token_encrypted TEXT NOT NULL,
        access_token_iv TEXT NOT NULL,
        access_token_tag TEXT NOT NULL,
        refresh_token_encrypted TEXT NOT NULL,
        refresh_token_iv TEXT NOT NULL,
        refresh_token_tag TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        spotify_user_id TEXT,
        display_name TEXT,
        email TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Create sessions table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )
    `);

    // Create indexes
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_users_spotify_id ON users(spotify_user_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_users_expires_at ON users(expires_at)`);
  }

  /**
   * Encrypt a string value
   */
  private encrypt(text: string): { encrypted: string; iv: string; authTag: string } {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.encryptionKey, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  }

  /**
   * Decrypt an encrypted value
   */
  private decrypt(encrypted: string, iv: string, authTag: string): string {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      this.encryptionKey,
      Buffer.from(iv, 'hex')
    );

    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Store or update user tokens
   */
  saveUserToken(token: UserToken): void {
    const encryptedAccess = this.encrypt(token.accessToken);
    const encryptedRefresh = this.encrypt(token.refreshToken);
    const now = Date.now();

    this.db.run(`
      INSERT INTO users (
        user_id,
        access_token_encrypted, access_token_iv, access_token_tag,
        refresh_token_encrypted, refresh_token_iv, refresh_token_tag,
        expires_at, spotify_user_id, display_name, email,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        access_token_encrypted = excluded.access_token_encrypted,
        access_token_iv = excluded.access_token_iv,
        access_token_tag = excluded.access_token_tag,
        refresh_token_encrypted = excluded.refresh_token_encrypted,
        refresh_token_iv = excluded.refresh_token_iv,
        refresh_token_tag = excluded.refresh_token_tag,
        expires_at = excluded.expires_at,
        spotify_user_id = excluded.spotify_user_id,
        display_name = excluded.display_name,
        email = excluded.email,
        updated_at = excluded.updated_at
    `, [
      token.userId,
      encryptedAccess.encrypted, encryptedAccess.iv, encryptedAccess.authTag,
      encryptedRefresh.encrypted, encryptedRefresh.iv, encryptedRefresh.authTag,
      token.expiresAt,
      token.spotifyUserId || null,
      token.displayName || null,
      token.email || null,
      token.createdAt || now,
      now
    ]);

    logger.info({ userId: token.userId, spotifyUserId: token.spotifyUserId }, 'User token saved');
  }

  /**
   * Get user token by userId
   */
  getUserToken(userId: string): UserToken | null {
    const row = this.db.get<Record<string, unknown>>(
      `SELECT * FROM users WHERE user_id = ?`,
      [userId]
    );

    if (!row) return null;

    try {
      const accessToken = this.decrypt(
        row.access_token_encrypted as string,
        row.access_token_iv as string,
        row.access_token_tag as string
      );
      const refreshToken = this.decrypt(
        row.refresh_token_encrypted as string,
        row.refresh_token_iv as string,
        row.refresh_token_tag as string
      );

      return {
        userId: row.user_id as string,
        sessionId: '', // Will be filled by caller if needed
        accessToken,
        refreshToken,
        expiresAt: row.expires_at as number,
        spotifyUserId: row.spotify_user_id as string | undefined,
        displayName: row.display_name as string | undefined,
        email: row.email as string | undefined,
        createdAt: row.created_at as number,
        updatedAt: row.updated_at as number
      };
    } catch (error) {
      logger.error({ error, userId }, 'Failed to decrypt token');
      return null;
    }
  }

  /**
   * Find a user by their refresh token
   * Note: This iterates through all users and decrypts their tokens.
   * For production with many users, consider adding a hash index.
   */
  findUserByRefreshToken(refreshToken: string): UserToken | null {
    const rows = this.db.all<{ user_id: string }>(`SELECT user_id FROM users`);

    for (const row of rows) {
      const token = this.getUserToken(row.user_id);
      if (token && token.refreshToken === refreshToken) {
        return token;
      }
    }

    return null;
  }

  /**
   * Link a session to a user
   */
  linkSession(sessionId: string, userId: string): void {
    const now = Date.now();

    this.db.run(`
      INSERT INTO sessions (session_id, user_id, created_at, last_accessed_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        user_id = excluded.user_id,
        last_accessed_at = excluded.last_accessed_at
    `, [sessionId, userId, now, now]);

    logger.info({ sessionId, userId }, 'Session linked to user');
  }

  /**
   * Get session info
   */
  getSession(sessionId: string): SessionInfo | null {
    const row = this.db.get<Record<string, unknown>>(
      `SELECT * FROM sessions WHERE session_id = ?`,
      [sessionId]
    );

    if (!row) return null;

    // Update last accessed timestamp
    this.db.run(
      `UPDATE sessions SET last_accessed_at = ? WHERE session_id = ?`,
      [Date.now(), sessionId]
    );

    return {
      sessionId: row.session_id as string,
      userId: row.user_id as string,
      createdAt: row.created_at as number,
      lastAccessedAt: row.last_accessed_at as number
    };
  }

  /**
   * Get user token by sessionId
   */
  getTokenBySession(sessionId: string): UserToken | null {
    const session = this.getSession(sessionId);
    if (!session) return null;

    const token = this.getUserToken(session.userId);
    if (token) {
      token.sessionId = sessionId;
    }
    return token;
  }

  /**
   * Get all sessions for a user
   */
  getSessionsForUser(userId: string): SessionInfo[] {
    const rows = this.db.all<{
      session_id: string;
      user_id: string;
      created_at: number;
      last_accessed_at: number;
    }>(
      `SELECT * FROM sessions WHERE user_id = ? ORDER BY last_accessed_at DESC`,
      [userId]
    );

    return rows.map(row => ({
      sessionId: row.session_id,
      userId: row.user_id,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at
    }));
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): void {
    this.db.run('DELETE FROM sessions WHERE session_id = ?', [sessionId]);
    logger.info({ sessionId }, 'Session deleted');
  }

  /**
   * Delete a user and all their sessions
   */
  deleteUser(userId: string): void {
    // Delete sessions first (due to foreign key)
    this.db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);

    // Delete user
    this.db.run('DELETE FROM users WHERE user_id = ?', [userId]);

    logger.info({ userId }, 'User and sessions deleted');
  }

  /**
   * Clean up expired tokens (older than 90 days)
   */
  cleanupExpiredTokens(maxAgeMs: number = 90 * 24 * 60 * 60 * 1000): number {
    const cutoffTime = Date.now() - maxAgeMs;

    // Get user IDs to delete
    const expiredUsers = this.db.all<{ user_id: string }>(
      `SELECT user_id FROM users WHERE updated_at < ?`,
      [cutoffTime]
    );

    // Delete them
    for (const user of expiredUsers) {
      this.deleteUser(user.user_id);
    }

    logger.info({ count: expiredUsers.length }, 'Expired tokens cleaned up');
    return expiredUsers.length;
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): SessionInfo[] {
    const rows = this.db.all<{
      session_id: string;
      user_id: string;
      created_at: number;
      last_accessed_at: number;
    }>('SELECT * FROM sessions ORDER BY last_accessed_at DESC');

    return rows.map(row => ({
      sessionId: row.session_id,
      userId: row.user_id,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at
    }));
  }

  /**
   * Get statistics
   */
  getStats(): { userCount: number; sessionCount: number; activeTokenCount: number } {
    const now = Date.now();

    const userCount = this.db.get<{ count: number }>('SELECT COUNT(*) as count FROM users');
    const sessionCount = this.db.get<{ count: number }>('SELECT COUNT(*) as count FROM sessions');
    const activeTokenCount = this.db.get<{ count: number }>(
      'SELECT COUNT(*) as count FROM users WHERE expires_at > ?',
      [now]
    );

    return {
      userCount: userCount?.count ?? 0,
      sessionCount: sessionCount?.count ?? 0,
      activeTokenCount: activeTokenCount?.count ?? 0
    };
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
    logger.info('TokenStore closed');
  }
}
