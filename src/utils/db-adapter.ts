/**
 * Database Adapter
 * 
 * Provides a unified interface for SQLite operations that works with both:
 * - Bun's native SQLite (local/Docker development)
 * - Turso/libSQL (Cloudflare/production)
 * 
 * Usage:
 *   const db = await createDbAdapter('tokens');
 *   await db.run('CREATE TABLE ...', []);
 *   const row = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
 */

import { Database as BunDatabase, type SQLQueryBindings } from 'bun:sqlite';
import { createClient, type Client as LibSqlClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import logger from './logger.js';

// Type alias for SQL parameters
type SqlParams = SQLQueryBindings[];

/**
 * Unified result type for database operations
 */
export interface DbRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

/**
 * Database adapter interface - all methods are sync for Bun SQLite compatibility
 * but can also work with async operations internally
 */
export interface DbAdapter {
  /**
   * Execute a SQL statement that doesn't return rows (CREATE, INSERT, UPDATE, DELETE)
   */
  run(sql: string, params?: unknown[]): DbRunResult;

  /**
   * Execute a query and return a single row
   */
  get<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | null;

  /**
   * Execute a query and return all matching rows
   */
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];

  /**
   * Close the database connection
   */
  close(): void;

  /**
   * Get the adapter type ('bun' or 'turso')
   */
  readonly type: 'bun' | 'turso';
}

/**
 * Bun SQLite adapter - for local/Docker development
 */
class BunSqliteAdapter implements DbAdapter {
  private db: BunDatabase;
  readonly type = 'bun' as const;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new BunDatabase(dbPath, { create: true });
    logger.info({ dbPath, adapter: 'bun' }, 'Database adapter initialized');
  }

  run(sql: string, params: unknown[] = []): DbRunResult {
    const stmt = this.db.prepare(sql);
    stmt.run(...(params as SqlParams));
    
    // Get changes and lastInsertRowid
    const result = this.db.query('SELECT changes() as changes, last_insert_rowid() as lastId').get() as {
      changes: number;
      lastId: number;
    };

    return {
      changes: result?.changes ?? 0,
      lastInsertRowid: result?.lastId ?? 0,
    };
  }

  get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | null {
    const stmt = this.db.prepare(sql);
    return stmt.get(...(params as SqlParams)) as T | null;
  }

  all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    const stmt = this.db.prepare(sql);
    return stmt.all(...(params as SqlParams)) as T[];
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Turso/libSQL adapter - for Cloudflare/production
 * 
 * Uses a local SQLite cache that syncs with Turso in the background.
 * This provides sync API compatibility while using async Turso operations.
 */
class TursoAdapter implements DbAdapter {
  private client: LibSqlClient;
  private localDb: BunDatabase;
  readonly type = 'turso' as const;
  private syncQueue: Array<{ sql: string; params: unknown[]; retries: number }> = [];
  private isSyncing = false;
  private isHydrated = false;
  private readonly MAX_RETRIES = 3;
  private readonly SYNC_DELAY_MS = 100; // Small delay between sync operations

  constructor(url: string, authToken: string, localDbPath: string) {
    this.client = createClient({
      url,
      authToken,
    });
    
    // Use local SQLite for immediate operations
    const dir = path.dirname(localDbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.localDb = new BunDatabase(localDbPath, { create: true });
    
    logger.info({ url: url.substring(0, 40), adapter: 'turso' }, 'Database adapter initialized');
    
    // Start background sync from Turso on startup (non-blocking)
    this.hydrateFromTurso().catch(err => {
      logger.error({ error: err }, 'Hydration failed but continuing with local DB');
    });
  }

  /**
   * Hydrate local DB from Turso on startup
   */
  private async hydrateFromTurso(): Promise<void> {
    try {
      // Get list of tables from Turso
      const tablesResult = await this.client.execute({
        sql: "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        args: [],
      });

      for (const row of tablesResult.rows) {
        const tableName = row.name as string;
        
        // Get table schema
        const schemaResult = await this.client.execute({
          sql: `SELECT sql FROM sqlite_master WHERE type='table' AND name=?`,
          args: [tableName],
        });
        
        if (schemaResult.rows.length > 0) {
          const createSql = schemaResult.rows[0].sql as string;
          // Create table locally if not exists
          try {
            this.localDb.run(createSql);
          } catch {
            // Table might already exist
          }
          
          // Fetch all data from Turso
          const dataResult = await this.client.execute({
            sql: `SELECT * FROM ${tableName}`,
            args: [],
          });
          
          if (dataResult.rows.length > 0) {
            // Get column names
            const columns = Object.keys(dataResult.rows[0]);
            const placeholders = columns.map(() => '?').join(', ');
            const insertSql = `INSERT OR REPLACE INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;
            
            for (const dataRow of dataResult.rows) {
              const values = columns.map(col => dataRow[col]);
              try {
                this.localDb.prepare(insertSql).run(...(values as SqlParams));
              } catch (e) {
                logger.error({ error: e, tableName }, 'Error inserting row during hydration');
              }
            }
            
            logger.info({ tableName, rowCount: dataResult.rows.length }, 'Hydrated table from Turso');
          }
        }
      }
      
      this.isHydrated = true;
      logger.info('Turso hydration complete');
    } catch (error) {
      logger.error({ error }, 'Failed to hydrate from Turso - starting fresh');
      this.isHydrated = true; // Mark as hydrated anyway to allow operations
    }
  }

  /**
   * Queue a write operation for sync to Turso
   */
  private queueSync(sql: string, params: unknown[]): void {
    this.syncQueue.push({ sql, params, retries: 0 });
    // Use setTimeout to batch multiple writes and avoid blocking
    setTimeout(() => this.processSyncQueue(), this.SYNC_DELAY_MS);
  }

  /**
   * Process queued sync operations with retry logic
   */
  private async processSyncQueue(): Promise<void> {
    if (this.isSyncing || this.syncQueue.length === 0) return;
    
    this.isSyncing = true;
    
    const failedItems: Array<{ sql: string; params: unknown[]; retries: number }> = [];
    
    while (this.syncQueue.length > 0) {
      const item = this.syncQueue.shift()!;
      try {
        await this.client.execute({
          sql: item.sql,
          args: item.params as never[],
        });
      } catch (error) {
        if (item.retries < this.MAX_RETRIES) {
          // Re-queue with incremented retry count
          failedItems.push({ ...item, retries: item.retries + 1 });
          logger.warn({ 
            sql: item.sql.substring(0, 50), 
            retries: item.retries + 1,
            maxRetries: this.MAX_RETRIES 
          }, 'Turso sync failed, will retry');
        } else {
          logger.error({ error, sql: item.sql.substring(0, 50) }, 'Turso sync failed after max retries');
        }
      }
      
      // Small delay between operations to avoid overwhelming the connection
      if (this.syncQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    
    // Re-add failed items for retry
    if (failedItems.length > 0) {
      this.syncQueue.push(...failedItems);
      // Schedule retry with exponential backoff
      setTimeout(() => this.processSyncQueue(), 1000);
    }
    
    this.isSyncing = false;
  }

  run(sql: string, params: unknown[] = []): DbRunResult {
    // Execute locally first
    const stmt = this.localDb.prepare(sql);
    stmt.run(...(params as SqlParams));
    
    const result = this.localDb.query('SELECT changes() as changes, last_insert_rowid() as lastId').get() as {
      changes: number;
      lastId: number;
    };
    
    // Queue for Turso sync (fire and forget)
    if (sql.trim().toUpperCase().startsWith('INSERT') || 
        sql.trim().toUpperCase().startsWith('UPDATE') || 
        sql.trim().toUpperCase().startsWith('DELETE') ||
        sql.trim().toUpperCase().startsWith('CREATE')) {
      this.queueSync(sql, params);
    }
    
    return {
      changes: result?.changes ?? 0,
      lastInsertRowid: result?.lastId ?? 0,
    };
  }

  get<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T | null {
    // Read from local DB
    const stmt = this.localDb.prepare(sql);
    return stmt.get(...(params as SqlParams)) as T | null;
  }

  all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
    // Read from local DB
    const stmt = this.localDb.prepare(sql);
    return stmt.all(...(params as SqlParams)) as T[];
  }

  close(): void {
    this.localDb.close();
    this.client.close();
  }
}

/**
 * Check if Turso is configured
 */
export function isTursoConfigured(): boolean {
  return !!(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
}

/**
 * Create a database adapter based on environment
 * 
 * @param dbName - Name of the database (used for local file path)
 * @param dataDir - Directory for local SQLite files (default: './data')
 */
export function createDbAdapter(dbName: string, dataDir: string = './data'): DbAdapter {
  if (isTursoConfigured()) {
    // Use Turso with local SQLite cache for production/Cloudflare
    const localDbPath = path.join(dataDir, `${dbName}.db`);
    return new TursoAdapter(
      process.env.TURSO_DATABASE_URL!,
      process.env.TURSO_AUTH_TOKEN!,
      localDbPath
    );
  } else {
    // Use local SQLite for development/Docker
    const dbPath = path.join(dataDir, `${dbName}.db`);
    return new BunSqliteAdapter(dbPath);
  }
}
