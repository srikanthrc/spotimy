import { Database } from 'bun:sqlite';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import logger from './logger.js';
import {
  ClientRegistrationRequest,
  ClientRegistrationResponse,
  RegisteredClient,
} from '../types/oauth.js';

/**
 * Manages OAuth 2.0 dynamic client registration (RFC 7591)
 *
 * This allows MCP Inspector and other clients to dynamically register
 * themselves without pre-configuration. Behind the scenes, we use the
 * pre-configured Spotify app credentials for actual OAuth flows.
 */
export class ClientRegistrationManager {
  private db: Database;

  constructor(dbPath?: string) {
    const defaultPath = path.join(process.cwd(), 'data', 'clients.db');
    const finalPath = dbPath || defaultPath;

    // Ensure directory exists
    const dir = path.dirname(finalPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(finalPath);
    this.initDatabase();
    logger.info({ dbPath: finalPath }, 'Client Registration Manager initialized');
  }

  private initDatabase() {
    // Create registered_clients table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS registered_clients (
        client_id TEXT PRIMARY KEY,
        client_secret TEXT NOT NULL,
        client_name TEXT,
        redirect_uris TEXT NOT NULL,
        grant_types TEXT NOT NULL,
        response_types TEXT NOT NULL,
        token_endpoint_auth_method TEXT NOT NULL,
        scope TEXT,
        created_at INTEGER NOT NULL,
        registration_access_token TEXT
      )
    `);

    logger.info('Client registration database tables created');
  }

  /**
   * Register a new OAuth client dynamically
   */
  registerClient(request: ClientRegistrationRequest): ClientRegistrationResponse {
    // Generate client credentials
    const clientId = this.generateClientId();
    const clientSecret = this.generateClientSecret();
    const registrationAccessToken = this.generateRegistrationAccessToken();
    const createdAt = Math.floor(Date.now() / 1000);

    // Use defaults if not provided
    const redirectUris = request.redirect_uris || [];
    const grantTypes = request.grant_types || ['authorization_code', 'refresh_token'];
    const responseTypes = request.response_types || ['code'];
    const tokenEndpointAuthMethod = request.token_endpoint_auth_method || 'client_secret_post';
    const scope = request.scope;

    // Store the registered client
    const stmt = this.db.query(`
      INSERT INTO registered_clients (
        client_id, client_secret, client_name, redirect_uris,
        grant_types, response_types, token_endpoint_auth_method,
        scope, created_at, registration_access_token
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      clientId,
      clientSecret,
      request.client_name || null,
      JSON.stringify(redirectUris),
      JSON.stringify(grantTypes),
      JSON.stringify(responseTypes),
      tokenEndpointAuthMethod,
      scope || null,
      createdAt,
      registrationAccessToken
    );

    logger.info({
      clientId,
      clientName: request.client_name,
      redirectUris,
    }, 'New OAuth client registered');

    // Build registration response
    const response: ClientRegistrationResponse = {
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: createdAt,
      client_secret_expires_at: 0, // Never expires
      redirect_uris: redirectUris,
      token_endpoint_auth_method: tokenEndpointAuthMethod,
      grant_types: grantTypes,
      response_types: responseTypes,
      client_name: request.client_name,
      client_uri: request.client_uri,
      logo_uri: request.logo_uri,
      scope: scope,
      contacts: request.contacts,
      tos_uri: request.tos_uri,
      policy_uri: request.policy_uri,
      registration_access_token: registrationAccessToken,
      // registration_client_uri would be set by the server
    };

    return response;
  }

  /**
   * Get a registered client by client_id
   */
  getClient(clientId: string): RegisteredClient | null {
    const stmt = this.db.query(`
      SELECT * FROM registered_clients WHERE client_id = ?
    `);

    const row = stmt.get(clientId) as any;
    if (!row) {
      logger.debug({ clientId }, 'Client lookup returned no results');
      return null;
    }

    logger.debug({
      clientId,
      found: true,
      clientName: row.client_name
    }, 'Client found in database');

    return {
      client_id: row.client_id,
      client_secret: row.client_secret,
      client_name: row.client_name,
      redirect_uris: JSON.parse(row.redirect_uris),
      grant_types: JSON.parse(row.grant_types),
      response_types: JSON.parse(row.response_types),
      token_endpoint_auth_method: row.token_endpoint_auth_method,
      scope: row.scope,
      created_at: row.created_at,
      registration_access_token: row.registration_access_token,
    };
  }

  /**
   * Validate client credentials
   */
  validateClient(clientId: string, clientSecret: string): boolean {
    const client = this.getClient(clientId);
    if (!client) {
      logger.warn({ clientId }, 'Client not found during validation');
      return false;
    }

    const isValid = client.client_secret === clientSecret;
    if (!isValid) {
      logger.warn({
        clientId,
        providedSecretLength: clientSecret.length,
        storedSecretLength: client.client_secret.length,
        secretsMatch: client.client_secret === clientSecret
      }, 'Client secret validation failed');
    } else {
      logger.info({ clientId }, 'Client credentials validated successfully');
    }

    return isValid;
  }

  /**
   * Delete a registered client
   */
  deleteClient(clientId: string): boolean {
    const stmt = this.db.query(`
      DELETE FROM registered_clients WHERE client_id = ?
    `);

    stmt.run(clientId);
    const changes = this.db.query('SELECT changes() as changes').get() as { changes: number };
    logger.info({ clientId, deleted: changes.changes > 0 }, 'Client deletion attempt');
    return changes.changes > 0;
  }

  /**
   * Get all registered clients (for admin purposes)
   */
  getAllClients(): RegisteredClient[] {
    const stmt = this.db.query(`
      SELECT * FROM registered_clients ORDER BY created_at DESC
    `);

    const rows = stmt.all() as any[];
    return rows.map(row => ({
      client_id: row.client_id,
      client_secret: row.client_secret,
      client_name: row.client_name,
      redirect_uris: JSON.parse(row.redirect_uris),
      grant_types: JSON.parse(row.grant_types),
      response_types: JSON.parse(row.response_types),
      token_endpoint_auth_method: row.token_endpoint_auth_method,
      scope: row.scope,
      created_at: row.created_at,
      registration_access_token: row.registration_access_token,
    }));
  }

  /**
   * Get client registration statistics
   */
  getStats() {
    const stmt = this.db.query(`
      SELECT COUNT(*) as total FROM registered_clients
    `);

    const result = stmt.get() as { total: number };
    return {
      totalClients: result.total,
    };
  }

  /**
   * Generate a unique client ID
   */
  private generateClientId(): string {
    return `mcp_${crypto.randomBytes(16).toString('hex')}`;
  }

  /**
   * Generate a secure client secret
   */
  private generateClientSecret(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  /**
   * Generate a registration access token
   */
  private generateRegistrationAccessToken(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  /**
   * Close database connection
   */
  close() {
    this.db.close();
    logger.info('Client Registration Manager closed');
  }
}
