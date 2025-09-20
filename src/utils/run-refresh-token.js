#!/usr/bin/env node

/**
 * Utility to refresh Spotify token via MCP server
 */

import fetch from 'node:fetch';

const MCP_SERVER_URL = 'http://localhost:3001';

async function refreshToken() {
  try {
    console.log('🔄 Refreshing Spotify token...');

    const response = await fetch(`${MCP_SERVER_URL}/refresh-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const result = await response.json();

    if (result.success) {
      console.log('✅ Success:', result.message);
      console.log('📝 Token status:', result.token);
    } else {
      console.log('❌ Error:', result.error);
      console.log('💡 Details:', result.details);

      if (result.details.includes('Authorization code expired')) {
        console.log('\n🔗 To get a new authorization code:');
        console.log('1. Visit: http://localhost:3001/auth');
        console.log('2. Click "Authorize Spotify Access" and complete authorization');
        console.log('3. Run this script again');
      }
    }

  } catch (error) {
    console.error('🚨 Network error:', error.message);
    console.log('💡 Make sure the MCP server is running on', MCP_SERVER_URL);
  }
}

async function checkHealth() {
  try {
    const response = await fetch(`${MCP_SERVER_URL}/health`);
    const health = await response.json();
    console.log('🏥 Server status:', health.status);
    console.log('📅 Server time:', health.timestamp);
    return true;
  } catch (error) {
    console.error('❌ Server not reachable:', error.message);
    return false;
  }
}

// Main execution
async function main() {
  console.log('🎵 Spotify Token Refresh Tool\n');

  // Check if server is running
  const serverReady = await checkHealth();
  if (!serverReady) {
    console.log('\n💡 Start the MCP server with: bun run mcp:http');
    process.exit(1);
  }

  // Refresh token
  await refreshToken();
}

main().catch(console.error);