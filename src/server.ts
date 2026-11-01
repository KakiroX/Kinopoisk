import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RedditClient } from "./reddit/client.js";
import { RedditService } from "./reddit/service.js";
import { registerRedditTools } from "./reddit/tools.js";
import { XClient } from "./x/client.js";
import { XService } from "./x/service.js";
import { registerXTools } from "./x/tools.js";

export const VERSION = "0.2.0";

export interface Services {
  reddit: RedditService;
  x?: XService;
}

/** Builds the API clients once per process so caches and rate-limit state are shared. */
export function createServices(env: NodeJS.ProcessEnv = process.env): Services {
  const ttl = env.CACHE_TTL ?? env.REDDIT_CACHE_TTL;
  const cacheTtlMs = ttl ? Number(ttl) * 1000 : undefined;
  const reddit = new RedditService(
    new RedditClient({
      userAgent: env.REDDIT_USER_AGENT || `node:social-mcp:${VERSION} (MCP server for Claude)`,
      clientId: env.REDDIT_CLIENT_ID || undefined,
      clientSecret: env.REDDIT_CLIENT_SECRET || undefined,
      username: env.REDDIT_USERNAME || undefined,
      password: env.REDDIT_PASSWORD || undefined,
      cacheTtlMs,
      publicBase: env.REDDIT_PUBLIC_BASE || undefined,
      oauthBase: env.REDDIT_OAUTH_BASE || undefined,
      tokenUrl: env.REDDIT_TOKEN_URL || undefined,
    }),
  );
  const x = env.X_BEARER_TOKEN
    ? new XService(
        new XClient({
          bearerToken: env.X_BEARER_TOKEN,
          dailyPostLimit: env.X_DAILY_POST_LIMIT !== undefined ? Number(env.X_DAILY_POST_LIMIT) : undefined,
          cacheTtlMs,
          baseUrl: env.X_API_BASE || undefined,
        }),
      )
    : undefined;
  return { reddit, x };
}

export function createServer(services: Services): McpServer {
  const server = new McpServer(
    { name: "social-mcp", version: VERSION },
    {
      instructions:
        "Read-only access to Reddit" +
        (services.x ? " and X (Twitter)" : "") +
        ". Prefer reddit_get_thread / x_get_thread when given a link to a discussion." +
        (services.x ? " X reads are billed per post, so request only as many posts as needed." : ""),
    },
  );
  registerRedditTools(server, services.reddit);
  if (services.x) registerXTools(server, services.x);
  return server;
}
