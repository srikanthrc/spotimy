import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import logger from './logger.js';

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
 * - SQLite database for persistence
 * - AES-256-GCM encryption for sensitive fields
 * - Session-to-user mapping
 * - Automatic token expiry cleanup
 */
export class TokenStore {
  private db: Database.Database;
  private encryptionKey: Buffer;
  private readonly dbPath: string;
  private readonly keyPath: string;

  constructor(dataDir: string = './data') {
    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.dbPath = path.join(dataDir, 'tokens.db');
    this.keyPath = path.join(dataDir, '.encryption-key');

    // Load or generate encryption key
    this.encryptionKey = this.loadOrGenerateKey();

    // Initialize database
    this.db = new Database(this.dbPath);
    this.initializeSchema();

    logger.info({ dbPath: this.dbPath }, 'TokenStore initialized');
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
    this.db.exec(`
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
      );

      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_users_spotify_id ON users(spotify_user_id);
      CREATE INDEX IF NOT EXISTS idx_users_expires_at ON users(expires_at);
    `);
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

    const stmt = this.db.prepare(`
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
    `);

    stmt.run(
      token.userId,
      encryptedAccess.encrypted, encryptedAccess.iv, encryptedAccess.authTag,
      encryptedRefresh.encrypted, encryptedRefresh.iv, encryptedRefresh.authTag,
      token.expiresAt,
      token.spotifyUserId || null,
      token.displayName || null,
      token.email || null,
      token.createdAt || now,
      now
    );

    logger.info({ userId: token.userId, spotifyUserId: token.spotifyUserId }, 'User token saved');
  }

  /**
   * Get user token by userId
   */
  getUserToken(userId: string): UserToken | null {
    const stmt = this.db.prepare(`
      SELECT * FROM users WHERE user_id = ?
    `);

    const row = stmt.get(userId) as any;
    if (!row) return null;

    try {
      const accessToken = this.decrypt(
        row.access_token_encrypted,
        row.access_token_iv,
        row.access_token_tag
      );
      const refreshToken = this.decrypt(
        row.refresh_token_encrypted,
        row.refresh_token_iv,
        row.refresh_token_tag
      );

      return {
        userId: row.user_id,
        sessionId: '', // Will be filled by caller if needed
        accessToken,
        refreshToken,
        expiresAt: row.expires_at,
        spotifyUserId: row.spotify_user_id,
        displayName: row.display_name,
        email: row.email,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    } catch (error) {
      logger.error({ error, userId }, 'Failed to decrypt token');
      return null;
    }
  }

  /**
   * Link a session to a user
   */
  linkSession(sessionId: string, userId: string): void {
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO sessions (session_id, user_id, created_at, last_accessed_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        user_id = excluded.user_id,
        last_accessed_at = excluded.last_accessed_at
    `);

    stmt.run(sessionId, userId, now, now);
    logger.info({ sessionId, userId }, 'Session linked to user');
  }

  /**
   * Get session info
   */
  getSession(sessionId: string): SessionInfo | null {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions WHERE session_id = ?
    `);

    const row = stmt.get(sessionId) as any;
    if (!row) return null;

    // Update last accessed timestamp
    const updateStmt = this.db.prepare(`
      UPDATE sessions SET last_accessed_at = ? WHERE session_id = ?
    `);
    updateStmt.run(Date.now(), sessionId);

    return {
      sessionId: row.session_id,
      userId: row.user_id,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at
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
   * Delete a session
   */
  deleteSession(sessionId: string): void {
    const stmt = this.db.prepare('DELETE FROM sessions WHERE session_id = ?');
    stmt.run(sessionId);
    logger.info({ sessionId }, 'Session deleted');
  }

  /**
   * Delete a user and all their sessions
   */
  deleteUser(userId: string): void {
    // Delete sessions first (due to foreign key)
    const sessionsStmt = this.db.prepare('DELETE FROM sessions WHERE user_id = ?');
    sessionsStmt.run(userId);

    // Delete user
    const userStmt = this.db.prepare('DELETE FROM users WHERE user_id = ?');
    userStmt.run(userId);

    logger.info({ userId }, 'User and sessions deleted');
  }

  /**
   * Clean up expired tokens (older than 90 days)
   */
  cleanupExpiredTokens(maxAgeMs: number = 90 * 24 * 60 * 60 * 1000): number {
    const cutoffTime = Date.now() - maxAgeMs;

    // Get user IDs to delete
    const selectStmt = this.db.prepare(`
      SELECT user_id FROM users WHERE updated_at < ?
    `);
    const expiredUsers = selectStmt.all(cutoffTime) as any[];

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
    const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY last_accessed_at DESC');
    const rows = stmt.all() as any[];

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

    const userCount = this.db.prepare('SELECT COUNT(*) as count FROM users').get() as any;
    const sessionCount = this.db.prepare('SELECT COUNT(*) as count FROM sessions').get() as any;
    const activeTokenCount = this.db.prepare(
      'SELECT COUNT(*) as count FROM users WHERE expires_at > ?'
    ).get(now) as any;

    return {
      userCount: userCount.count,
      sessionCount: sessionCount.count,
      activeTokenCount: activeTokenCount.count
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
