#!/usr/bin/env node
/**
 * Migration utility to import tokens from .env file to secure database
 *
 * Usage:
 *   bun src/utils/migrate-tokens.ts
 *   or
 *   node build/utils/migrate-tokens.js
 */

import fs from 'fs';
import path from 'path';
import { TokenStore, UserToken } from './token-store.js';
import logger from './logger.js';
import crypto from 'crypto';

interface EnvTokens {
  SPOTIFY_USER_ACCESS_TOKEN?: string;
  SPOTIFY_REFRESH_TOKEN?: string;
  SPOTIFY_TOKEN_EXPIRES_AT?: string;
}

function loadEnvTokens(envPath: string): EnvTokens | null {
  if (!fs.existsSync(envPath)) {
    logger.warn({ envPath }, '.env file not found');
    return null;
  }

  const envContent = fs.readFileSync(envPath, 'utf8');
  const tokens: EnvTokens = {};

  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^#][^=]*?)="?([^"]*)"?$/);
    if (match) {
      const [, key, value] = match;
      const trimmedKey = key.trim();
      const trimmedValue = value.trim();

      if (trimmedKey === 'SPOTIFY_USER_ACCESS_TOKEN' && trimmedValue) {
        tokens.SPOTIFY_USER_ACCESS_TOKEN = trimmedValue;
      } else if (trimmedKey === 'SPOTIFY_REFRESH_TOKEN' && trimmedValue) {
        tokens.SPOTIFY_REFRESH_TOKEN = trimmedValue;
      } else if (trimmedKey === 'SPOTIFY_TOKEN_EXPIRES_AT' && trimmedValue) {
        tokens.SPOTIFY_TOKEN_EXPIRES_AT = trimmedValue;
      }
    }
  });

  return tokens;
}

async function validateAndFetchUserInfo(accessToken: string): Promise<{
  id: string;
  display_name: string;
  email: string;
} | null> {
  try {
    const response = await fetch('https://api.spotify.com/v1/me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });

    if (!response.ok) {
      logger.warn({ status: response.status }, 'Token validation failed');
      return null;
    }

    const data = await response.json();
    return {
      id: data.id,
      display_name: data.display_name,
      email: data.email
    };
  } catch (error) {
    logger.error({ error }, 'Failed to validate token');
    return null;
  }
}

async function migrateTokens() {
  logger.info('Starting token migration from .env to secure database');

  const envPath = path.join(process.cwd(), '.env');
  const tokens = loadEnvTokens(envPath);

  if (!tokens || !tokens.SPOTIFY_USER_ACCESS_TOKEN || !tokens.SPOTIFY_REFRESH_TOKEN) {
    logger.warn('No user tokens found in .env file. Nothing to migrate.');
    logger.info('If you need to authorize, start the HTTP server and visit /auth?sessionId=<your-session-id>');
    return;
  }

  logger.info('Found tokens in .env file, validating...');

  // Validate token and get user info
  const userInfo = await validateAndFetchUserInfo(tokens.SPOTIFY_USER_ACCESS_TOKEN);
  if (!userInfo) {
    logger.error('Token validation failed. Token may be expired or invalid.');
    logger.info('Please re-authorize by starting the HTTP server and visiting /auth?sessionId=<your-session-id>');
    return;
  }

  logger.info({ userId: userInfo.id, displayName: userInfo.display_name }, 'Token validated successfully');

  // Initialize token store
  const dataDir = process.env.TOKEN_STORE_PATH || './data';
  const tokenStore = new TokenStore(dataDir);

  // Create a default session ID for migrated tokens
  const defaultSessionId = 'migrated-' + crypto.randomBytes(16).toString('hex');

  // Parse expiry timestamp
  let expiresAt = Date.now() + (3600 * 1000); // Default to 1 hour from now
  if (tokens.SPOTIFY_TOKEN_EXPIRES_AT) {
    const parsedExpiry = parseInt(tokens.SPOTIFY_TOKEN_EXPIRES_AT);
    if (!isNaN(parsedExpiry)) {
      expiresAt = parsedExpiry;
    }
  }

  // Create user token object
  const userToken: UserToken = {
    userId: userInfo.id,
    sessionId: defaultSessionId,
    accessToken: tokens.SPOTIFY_USER_ACCESS_TOKEN,
    refreshToken: tokens.SPOTIFY_REFRESH_TOKEN,
    expiresAt,
    spotifyUserId: userInfo.id,
    displayName: userInfo.display_name,
    email: userInfo.email,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  // Save to database
  tokenStore.saveUserToken(userToken);
  tokenStore.linkSession(defaultSessionId, userInfo.id);

  logger.info({ userId: userInfo.id, sessionId: defaultSessionId }, 'Token migration completed successfully');
  logger.info('');
  logger.info('IMPORTANT: Your tokens have been migrated to the secure database.');
  logger.info(`Session ID: ${defaultSessionId}`);
  logger.info('');
  logger.info('Next steps:');
  logger.info('1. You can safely remove the following from your .env file:');
  logger.info('   - SPOTIFY_USER_ACCESS_TOKEN');
  logger.info('   - SPOTIFY_REFRESH_TOKEN');
  logger.info('   - SPOTIFY_AUTH_CODE');
  logger.info('   - SPOTIFY_TOKEN_EXPIRES_AT');
  logger.info('');
  logger.info('2. Keep SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env');
  logger.info('');
  logger.info('3. Back up the following files (they contain encrypted tokens):');
  logger.info(`   - ${path.join(dataDir, 'tokens.db')}`);
  logger.info(`   - ${path.join(dataDir, '.encryption-key')}`);
  logger.info('');
  logger.info('4. For new sessions, use: /auth?sessionId=<your-new-session-id>');

  tokenStore.close();
}

// Run migration if executed directly
if (import.meta.main || process.argv[1] === new URL(import.meta.url).pathname) {
  migrateTokens().catch(error => {
    logger.error({ error }, 'Migration failed');
    process.exit(1);
  });
}

export { migrateTokens };
