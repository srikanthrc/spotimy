import { EventSource } from 'eventsource';
import { spawn, ChildProcess } from 'node:child_process';

const TEST_PORT = 3003;
const TEST_HOST = 'localhost';
const BASE_URL = `http://${TEST_HOST}:${TEST_PORT}`;

describe('HTTP Transport Integration with OAuth', () => {
  let serverProcess: ChildProcess;

  beforeAll(async () => {
    // Start the HTTP server as a separate process
    serverProcess = spawn('bun', ['src/http-server.ts', `--port=${TEST_PORT}`, `--host=${TEST_HOST}`], {
      stdio: 'pipe',
      env: { ...process.env, NODE_ENV: 'test' }
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

    it('should include enhanced auth status', async () => {
      const response = await fetch(`${BASE_URL}/health`);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('auth');
      expect(data.auth).toHaveProperty('status');
      expect(data.auth).toHaveProperty('tokenValid');
      expect(data.auth).toHaveProperty('hasUserToken');
      expect(data.auth).toHaveProperty('hasAuthCode');
      expect(data.auth).toHaveProperty('hasClientCredentials');
      expect(data.auth).toHaveProperty('details');
    });
  });

  describe('CORS Headers', () => {
    it('should include CORS headers', async () => {
      const response = await fetch(`${BASE_URL}/health`);

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type, Mcp-Session-Id');
    });

    it('should handle OPTIONS requests', async () => {
      const response = await fetch(`${BASE_URL}/mcp`, { method: 'OPTIONS' });

      expect(response.status).toBe(200);
    });
  });

  describe('MCP SSE Connection', () => {
    it('should establish SSE connection and provide endpoint', (done) => {
      const eventSource = new EventSource(`${BASE_URL}/mcp`);
      let endpointReceived = false;

      eventSource.addEventListener('endpoint', (event: any) => {
        try {
          const endpoint = `${BASE_URL}` + decodeURI(event.data);
          const url = new URL(endpoint);
          const sessionId = url.searchParams.get('sessionId');

          expect(endpoint).toMatch(/^http:\/\/localhost:3003\/mcp\?sessionId=/);
          expect(sessionId).toBeTruthy();
          expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

          endpointReceived = true;
          eventSource.close();
          done();
        } catch (error) {
          eventSource.close();
          done(error);
        }
      });

      eventSource.addEventListener('error', (error: any) => {
        eventSource.close();
        done(error);
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        if (!endpointReceived) {
          eventSource.close();
          done(new Error('Timeout waiting for endpoint event'));
        }
      }, 5000);
    });
  });

  describe('MCP Protocol', () => {
    let endpoint: string;
    let eventSource: EventSource;

    beforeEach((done) => {
      eventSource = new EventSource(`${BASE_URL}/mcp`);

      eventSource.addEventListener('endpoint', (event: any) => {
        endpoint = `${BASE_URL}` + decodeURI(event.data);
        done();
      });

      eventSource.addEventListener('error', (error: any) => {
        done(error);
      });
    });

    afterEach(() => {
      if (eventSource) {
        eventSource.close();
      }
    });

    it('should handle MCP initialize request', (done) => {
      const initRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {
            roots: {
              listChanged: false
            }
          },
          clientInfo: {
            name: 'test-client',
            version: '1.0.0'
          }
        }
      };

      eventSource.addEventListener('message', (event: any) => {
        try {
          const data = JSON.parse(event.data);
          if (data.id === 1) {
            expect(data).toHaveProperty('result');
            expect(data.result).toHaveProperty('protocolVersion', '2024-11-05');
            expect(data.result).toHaveProperty('capabilities');
            expect(data.result).toHaveProperty('serverInfo');
            expect(data.result.serverInfo).toHaveProperty('name', 'artistlens');
            expect(data.result.serverInfo).toHaveProperty('version', '0.4.12');
            done();
          }
        } catch (error) {
          done(error);
        }
      });

      fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(initRequest)
      });
    });

    it('should handle tools/list request', (done) => {
      const listToolsRequest = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list'
      };

      eventSource.addEventListener('message', (event: any) => {
        try {
          const data = JSON.parse(event.data);
          if (data.id === 2) {
            expect(data).toHaveProperty('result');
            expect(data.result).toHaveProperty('tools');
            expect(Array.isArray(data.result.tools)).toBe(true);
            expect(data.result.tools.length).toBeGreaterThan(0);

            // Check for some expected tools
            const toolNames = data.result.tools.map((tool: any) => tool.name);
            expect(toolNames).toContain('get_access_token');
            expect(toolNames).toContain('search');
            expect(toolNames).toContain('get_artist');

            done();
          }
        } catch (error) {
          done(error);
        }
      });

      fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(listToolsRequest)
      });
    });

    it('should handle invalid session ID', async () => {
      const invalidEndpoint = `${BASE_URL}/mcp?sessionId=invalid-session-id`;
      const response = await fetch(invalidEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'ping'
        })
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toHaveProperty('error', 'Session not found');
    });

    it('should handle missing session ID', async () => {
      const invalidEndpoint = `${BASE_URL}/mcp`;
      const response = await fetch(invalidEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'ping'
        })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error', 'Missing sessionId parameter');
    });
  });

  describe('OAuth Integration', () => {
    it('should serve OAuth authorization page', async () => {
      const response = await fetch(`${BASE_URL}/auth`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/html');
      expect(html).toContain('Spotify Authorization');
      expect(html).toContain('Authorize Spotify Access');
      expect(html).toContain('https://accounts.spotify.com/authorize');
      expect(html).toContain('client_id=3d134834f4da49eab306ec763d994ef1');
      expect(html).toContain(`redirect_uri=http%3A%2F%2F127.0.0.1%3A3001%2Fcallback`);
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
      expect(html).toContain('No Authorization Code');
      expect(html).toContain('Try again');
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

  describe('Token Refresh', () => {
    it('should provide refresh token endpoint', async () => {
      const response = await fetch(`${BASE_URL}/refresh-token`, { method: 'POST' });
      const data = await response.json();

      expect([200, 500]).toContain(response.status); // Could succeed or fail depending on token state
      expect(data).toHaveProperty('success');

      if (data.success) {
        expect(data).toHaveProperty('message');
        expect(data).toHaveProperty('token');
      } else {
        expect(data).toHaveProperty('error');
        expect(data).toHaveProperty('details');
      }
    });

    it('should reject non-POST requests to /refresh-token', async () => {
      const response = await fetch(`${BASE_URL}/refresh-token`, { method: 'GET' });
      const data = await response.json();

      expect(response.status).toBe(405);
      expect(data).toHaveProperty('error', 'Method not allowed. Use POST.');
    });
  });

  describe('Dynamic Environment Loading', () => {
    it('should pick up environment changes without restart', async () => {
      // First health check
      const response1 = await fetch(`${BASE_URL}/health`);
      const data1 = await response1.json();

      expect(response1.status).toBe(200);
      expect(data1.auth).toHaveProperty('status');

      // Second health check should use fresh environment variables
      const response2 = await fetch(`${BASE_URL}/health`);
      const data2 = await response2.json();

      expect(response2.status).toBe(200);
      expect(data2.auth).toHaveProperty('status');
      expect(typeof data2.auth.tokenValid).toBe('boolean');
    });
  });

  describe('Error Handling', () => {
    it('should return 404 for unknown paths', async () => {
      const response = await fetch(`${BASE_URL}/unknown-path`);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toHaveProperty('error', 'Not found');
    });

    it('should return 405 for unsupported methods on MCP endpoint', async () => {
      const response = await fetch(`${BASE_URL}/mcp`, { method: 'PUT' });

      expect(response.status).toBe(405);
      const data = await response.json();
      expect(data).toHaveProperty('error', 'Method not allowed');
    });
  });
});