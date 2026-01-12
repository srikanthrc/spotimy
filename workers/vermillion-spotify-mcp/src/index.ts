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
  // Turso database credentials (secrets)
  TURSO_DATABASE_URL?: string;
  TURSO_AUTH_TOKEN?: string;
  // Application branding (from wrangler.jsonc vars)
  APP_DOMAIN?: string;
  APP_NAME?: string;
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
      // Application branding for OAuth consent screen
      ...(env.APP_DOMAIN && { APP_DOMAIN: env.APP_DOMAIN }),
      ...(env.APP_NAME && { APP_NAME: env.APP_NAME }),
      // Turso database for persistent storage
      ...(env.TURSO_DATABASE_URL && { TURSO_DATABASE_URL: env.TURSO_DATABASE_URL }),
      ...(env.TURSO_AUTH_TOKEN && { TURSO_AUTH_TOKEN: env.TURSO_AUTH_TOKEN }),
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
    
    // Worker-level info endpoint (doesn't require container)
    if (url.pathname === "/") {
      return new Response(JSON.stringify({
        status: "ok",
        name: "vermillion-spotify-mcp",
        platform: "cloudflare-containers",
        message: "Spotify MCP Server on Cloudflare Containers",
        hasClientId: !!env.SPOTIFY_CLIENT_ID,
        hasClientSecret: !!env.SPOTIFY_CLIENT_SECRET,
        hasWorkerUrl: !!env.WORKER_URL,
        hasTurso: !!(env.TURSO_DATABASE_URL && env.TURSO_AUTH_TOKEN),
        workerUrl: env.WORKER_URL || "NOT SET",
        endpoints: {
          sse: "/sse",
          health: "/health",
          auth: "/auth?sessionId=<id>",
          warm: "/warm (pre-warm container)",
        }
      }, null, 2), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // Pre-warm endpoint - starts container without waiting for full startup
    if (url.pathname === "/warm") {
      try {
        const container = env.SPOTIFY_MCP.get(
          env.SPOTIFY_MCP.idFromName("default")
        );
        // Fire-and-forget health check to wake container
        container.fetch(new Request(`${url.origin}/health`)).catch(() => {});
        return new Response(JSON.stringify({
          status: "warming",
          message: "Container warm-up initiated",
        }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (error) {
        return new Response(JSON.stringify({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
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
  },

  /**
   * Scheduled trigger to keep container warm (runs every 5 minutes via cron)
   */
  async scheduled(event: ScheduledEvent, env: SpotifyEnv, ctx: ExecutionContext): Promise<void> {
    console.log("Scheduled warm-up triggered at:", new Date(event.scheduledTime).toISOString());
    try {
      const container = env.SPOTIFY_MCP.get(
        env.SPOTIFY_MCP.idFromName("default")
      );
      // Wake the container with a health check
      const response = await container.fetch(new Request("http://internal/health"));
      console.log("Warm-up health check:", response.status);
    } catch (error) {
      console.error("Scheduled warm-up error:", error);
    }
  }
};
