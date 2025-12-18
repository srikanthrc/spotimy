import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { spawn, ChildProcess } from 'node:child_process';

const TEST_PORT = 3003;
const TEST_HOST = 'localhost';
const BASE_URL = `http://${TEST_HOST}:${TEST_PORT}`;

describe('HTTP Transport Integration with OAuth', () => {
  let serverProcess: ChildProcess;

  beforeAll(async () => {
    // Start the HTTP server as a separate process
    serverProcess = spawn('bun', ['src/http-server.ts'], {
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'test', HTTP_PORT: String(TEST_PORT), HTTP_HOST: TEST_HOST }
    });

    // Wait for server to start
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 10000);

      const checkServer = async () => {
        try {
          const response = await fetch(`${BASE_URL}/health`);
          if (response.ok) {
            clearTimeout(timeout);
            resolve(undefined);
          } else {
            setTimeout(checkServer, 100);
          }
        } catch {
          setTimeout(checkServer, 100);
        }
      };

      checkServer();
    });
  });

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill();
      // Wait for process to actually exit
      await new Promise(resolve => {
        serverProcess.on('exit', resolve);
        setTimeout(resolve, 1000); // fallback timeout
      });
    }
  });

  describe('Health Check', () => {
    it('should return health status', async () => {
      const response = await fetch(`${BASE_URL}/health`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('status', 'ok');
      expect(data).toHaveProperty('timestamp');
    });

    it('should include auth status', async () => {
      const response = await fetch(`${BASE_URL}/health`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('auth');
      expect(data.auth).toHaveProperty('status');
    });
  });

  describe('CORS Headers', () => {
    it('should include CORS headers', async () => {
      const response = await fetch(`${BASE_URL}/health`);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS, PUT, DELETE');
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Authorization, Mcp-Session-Id');
    });

    it('should handle OPTIONS requests', async () => {
      const response = await fetch(`${BASE_URL}/sse`, { method: 'OPTIONS' });

      expect(response.status).toBe(200);
    });
  });

  describe('OAuth Metadata Endpoints', () => {
    it('should serve OAuth authorization server metadata', async () => {
      const response = await fetch(`${BASE_URL}/authorize`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('issuer');
      expect(data).toHaveProperty('authorization_endpoint');
      expect(data).toHaveProperty('token_endpoint');
      expect(data).toHaveProperty('registration_endpoint');
    });

    it('should serve MCP resource metadata', async () => {
      const response = await fetch(`${BASE_URL}/mcp-metadata`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('authorizationEndpoint');
      expect(data).toHaveProperty('tokenEndpoint');
      expect(data).toHaveProperty('resourceServer');
    });

    it('should serve well-known OAuth protected resource', async () => {
      const response = await fetch(`${BASE_URL}/.well-known/oauth-protected-resource`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('authorizationServer');
      expect(data).toHaveProperty('tokenEndpoint');
    });
  });

  describe('MCP Endpoint Auth', () => {
    it('should return 401 for unauthenticated GET to /sse', async () => {
      const response = await fetch(`${BASE_URL}/sse`);
      
      // Server should require authentication
      expect(response.status).toBe(401);
      expect(response.headers.get('WWW-Authenticate')).toBeTruthy();
    });

    it('should return 400 for POST to /sse without sessionId', async () => {
      const response = await fetch(`${BASE_URL}/sse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
      });
      
      // POST without sessionId returns 400 "Missing sessionId parameter"
      expect(response.status).toBe(400);
    });
  });

  describe('OAuth Integration', () => {
    it('should serve OAuth authorization page with sessionId', async () => {
      // /auth works with sessionId (our custom flow) without needing a registered client
      const response = await fetch(`${BASE_URL}/auth?sessionId=test-session-123`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(html).toContain('Spotify');
    });

    it('should return 400 for /auth without required params', async () => {
      const response = await fetch(`${BASE_URL}/auth`);
      expect(response.status).toBe(400);
    });

    it('should reject non-GET requests to /auth', async () => {
      const response = await fetch(`${BASE_URL}/auth`, { method: 'POST' });
      const data = await response.json();

      expect(response.status).toBe(405);
      expect(data).toHaveProperty('error', 'Method not allowed. Use GET.');
    });

    it('should handle callback with missing code', async () => {
      const response = await fetch(`${BASE_URL}/callback`);
      const html = await response.text();

      expect(response.status).toBe(400);
      expect(html).toContain('Invalid Callback');
    });

    it('should handle callback with error parameter', async () => {
      const response = await fetch(`${BASE_URL}/callback?error=access_denied`);
      const html = await response.text();

      expect(response.status).toBe(400);
      expect(html).toContain('Authorization Error');
      expect(html).toContain('access_denied');
    });

    it('should reject non-GET requests to /callback', async () => {
      const response = await fetch(`${BASE_URL}/callback`, { method: 'POST' });
      const data = await response.json();

      expect(response.status).toBe(405);
      expect(data).toHaveProperty('error', 'Method not allowed. Use GET.');
    });
  });

  describe('Session Revocation', () => {
    it('should provide session revoke endpoint', async () => {
      const testSessionId = 'test-session-123';
      const response = await fetch(`${BASE_URL}/revoke?sessionId=${testSessionId}`, { method: 'POST' });
      const data = await response.json();

      // Could succeed or fail depending on session state
      expect([200, 500]).toContain(response.status);
      expect(data).toHaveProperty('success');
    });

    it('should reject non-POST requests to /revoke', async () => {
      const testSessionId = 'test-session-123';
      const response = await fetch(`${BASE_URL}/revoke?sessionId=${testSessionId}`, { method: 'GET' });
      const data = await response.json();

      expect(response.status).toBe(405);
      expect(data).toHaveProperty('error', 'Method not allowed. Use POST.');
    });

    it('should reject revoke requests without sessionId', async () => {
      const response = await fetch(`${BASE_URL}/revoke`, { method: 'POST' });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toHaveProperty('error', 'Missing sessionId parameter');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown paths', async () => {
      const response = await fetch(`${BASE_URL}/unknown-path`);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toHaveProperty('error', 'Not found');
    });
  });
});
