/**
 * Spotify MCP Server - Cloudflare Containers
 * 
 * This Worker runs the existing Node.js/Bun MCP server inside a Cloudflare Container.
 * No code duplication - the container runs the exact same code as local/Docker deployments.
 * 
 * Endpoints (proxied to container):
 *   GET/POST /sse        - MCP SSE transport
 *   GET      /health     - Health check
 *   GET      /auth       - OAuth authorization
 *   GET      /callback   - OAuth callback
 *   POST     /token      - Token exchange
 *   POST     /register   - Dynamic client registration
 */

import { Container } from "@cloudflare/containers";

// Define our environment including secrets and the generated DO binding
interface SpotifyEnv {
  // Secrets (set via wrangler secret)
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
  WORKER_URL?: string;
  // Durable Object binding (from wrangler.jsonc)
  SPOTIFY_MCP: DurableObjectNamespace<SpotifyMcpContainer>;
}

/**
 * Container-backed Durable Object that runs the Spotify MCP server.
 * Extends the Container class from @cloudflare/containers.
 * 
 * Environment variables are set in constructor and passed to container on start.
 */
export class SpotifyMcpContainer extends Container<SpotifyEnv> {
  // Port the MCP server listens on (matches EXPOSE in Dockerfile)
  defaultPort = 3001;
  
  // Keep container running for a very long time (effectively always-on)
  // Maximum practical value - container restarts will happen on deployments anyway
  sleepAfter = "168h"; // 7 days
  
  // Enable internet access for Spotify API calls
  enableInternet = true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(ctx: any, env: SpotifyEnv) {
    super(ctx, env);
    
    // Build NGROK_DOMAIN from WORKER_URL
    const ngrokDomain = env.WORKER_URL 
      ? new URL(env.WORKER_URL).host 
      : undefined;

    // Build redirect URI from WORKER_URL
    const redirectUri = env.WORKER_URL 
      ? `${env.WORKER_URL}/callback`
      : undefined;

    // Set environment variables that will be passed to the container
    this.envVars = {
      SPOTIFY_CLIENT_ID: env.SPOTIFY_CLIENT_ID || "",
      SPOTIFY_CLIENT_SECRET: env.SPOTIFY_CLIENT_SECRET || "",
      HTTP_PORT: "3001",
      HTTP_HOST: "0.0.0.0",
      NODE_ENV: "production",
      LOG_LEVEL: "info",
      ...(ngrokDomain && { NGROK_DOMAIN: ngrokDomain }),
      ...(redirectUri && { SPOTIFY_REDIRECT_URI: redirectUri }),
    };
    
    console.log("SpotifyMcpContainer initialized with envVars:", Object.keys(this.envVars));
  }

  override onStart(): void {
    console.log("Spotify MCP container started");
  }

  override onStop(): void {
    console.log("Spotify MCP container stopped");
  }

  override onError(error: unknown): void {
    console.error("Spotify MCP container error:", error);
  }
}

/**
 * Worker entry point - routes requests to Container instances
 */
export default {
  async fetch(request: Request, env: SpotifyEnv): Promise<Response> {
    const url = new URL(request.url);
    
    // Health check at worker level (before container routing)
    if (url.pathname === "/") {
      return new Response(JSON.stringify({
        status: "ok",
        name: "vermillion-spotify-mcp",
        platform: "cloudflare-containers",
        message: "Spotify MCP Server on Cloudflare Containers",
        hasClientId: !!env.SPOTIFY_CLIENT_ID,
        hasClientSecret: !!env.SPOTIFY_CLIENT_SECRET,
        hasWorkerUrl: !!env.WORKER_URL,
        workerUrl: env.WORKER_URL || "NOT SET",
        endpoints: {
          sse: "/sse",
          health: "/health",
          auth: "/auth?sessionId=<id>",
        }
      }, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }

    try {
      // Get or create a container instance
      // Using "default" as the name means all requests go to the same container
      // For multi-tenant, you could use sessionId or other identifier
      const container = env.SPOTIFY_MCP.get(
        env.SPOTIFY_MCP.idFromName("default")
      );

      // Proxy the request to the container
      // The container runs the full MCP server (http-server.ts)
      return await container.fetch(request);
    } catch (error) {
      console.error("Container error:", error);
      return new Response(JSON.stringify({
        error: "Container error",
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }, null, 2), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
};
