#!/usr/bin/env node

/**
 * Utility to refresh Spotify token via MCP server
 */

import fetch from 'node:fetch';
import pino from 'pino';

const logger = pino({
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss Z',
      ignore: 'pid,hostname'
    }
  }
}, process.stderr);

const MCP_SERVER_URL = 'http://localhost:3001';

async function refreshToken() {
  try {
    logger.info('Refreshing Spotify token...');

    const response = await fetch(`${MCP_SERVER_URL}/refresh-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const result = await response.json();

    if (result.success) {
      logger.info({ message: result.message, token: result.token }, 'Token refresh successful');
    } else {
      logger.error({ error: result.error, details: result.details }, 'Token refresh failed');

      if (result.details.includes('Authorization code expired')) {
        logger.info('To get a new authorization code:');
        logger.info('1. Visit: http://localhost:3001/auth');
        logger.info('2. Click "Authorize Spotify Access" and complete authorization');
        logger.info('3. Run this script again');
      }
    }

  } catch (error) {
    logger.error({ error: error.message, serverUrl: MCP_SERVER_URL }, 'Network error - make sure MCP server is running');
  }
}

async function checkHealth() {
  try {
    const response = await fetch(`${MCP_SERVER_URL}/health`);
    const health = await response.json();
    logger.info({ status: health.status, timestamp: health.timestamp }, 'Server health check');
    return true;
  } catch (error) {
    logger.error({ error: error.message }, 'Server not reachable');
    return false;
  }
}

// Main execution
async function main() {
  logger.info('Spotify Token Refresh Tool');

  // Check if server is running
  const serverReady = await checkHealth();
  if (!serverReady) {
    logger.info('Start the MCP server with: bun run mcp:http');
    process.exit(1);
  }

  // Refresh token
  await refreshToken();
}

main().catch(error => logger.error({ error }, 'Script execution failed'));