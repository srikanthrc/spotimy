import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import logger from './logger.js';
import {
  ClientRegistrationRequest,
  ClientRegistrationResponse,
  RegisteredClient,
} from '../types/oauth.js';
import { createDbAdapter, type DbAdapter } from './db-adapter.js';

/**
 * Manages OAuth 2.0 dynamic client registration (RFC 7591)
 *
 * This allows MCP Inspector and other clients to dynamically register
 * themselves without pre-configuration. Behind the scenes, we use the
 * pre-configured Spotify app credentials for actual OAuth flows.
 */
export class ClientRegistrationManager {
  private db: DbAdapter;

  constructor(dbPath?: string) {
    // Extract data directory from path, or use default
    const dataDir = dbPath ? path.dirname(dbPath) : path.join(process.cwd(), 'data');

    // Ensure directory exists (for local deployments)
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Initialize database adapter (auto-selects based on environment)
    this.db = createDbAdapter('clients', dataDir);
    this.initDatabase();
    logger.info({ dataDir, dbType: this.db.type }, 'Client Registration Manager initialized');
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
    this.db.run(`
      INSERT INTO registered_clients (
        client_id, client_secret, client_name, redirect_uris,
        grant_types, response_types, token_endpoint_auth_method,
        scope, created_at, registration_access_token
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
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
    ]);

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
    const row = this.db.get<Record<string, unknown>>(
      `SELECT * FROM registered_clients WHERE client_id = ?`,
      [clientId]
    );

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
      client_id: row.client_id as string,
      client_secret: row.client_secret as string,
      client_name: row.client_name as string | undefined,
      redirect_uris: JSON.parse(row.redirect_uris as string),
      grant_types: JSON.parse(row.grant_types as string),
      response_types: JSON.parse(row.response_types as string),
      token_endpoint_auth_method: row.token_endpoint_auth_method as string,
      scope: row.scope as string | undefined,
      created_at: row.created_at as number,
      registration_access_token: row.registration_access_token as string | undefined,
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
    const result = this.db.run(
      `DELETE FROM registered_clients WHERE client_id = ?`,
      [clientId]
    );

    logger.info({ clientId, deleted: result.changes > 0 }, 'Client deletion attempt');
    return result.changes > 0;
  }

  /**
   * Get all registered clients (for admin purposes)
   */
  getAllClients(): RegisteredClient[] {
    const rows = this.db.all<Record<string, unknown>>(
      `SELECT * FROM registered_clients ORDER BY created_at DESC`
    );

    return rows.map(row => ({
      client_id: row.client_id as string,
      client_secret: row.client_secret as string,
      client_name: row.client_name as string | undefined,
      redirect_uris: JSON.parse(row.redirect_uris as string),
      grant_types: JSON.parse(row.grant_types as string),
      response_types: JSON.parse(row.response_types as string),
      token_endpoint_auth_method: row.token_endpoint_auth_method as string,
      scope: row.scope as string | undefined,
      created_at: row.created_at as number,
      registration_access_token: row.registration_access_token as string | undefined,
    }));
  }

  /**
   * Get client registration statistics
   */
  getStats() {
    const result = this.db.get<{ total: number }>(
      `SELECT COUNT(*) as total FROM registered_clients`
    );

    return {
      totalClients: result?.total ?? 0,
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
