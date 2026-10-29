import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Services, createServer } from "./server.js";

export interface HttpOptions {
  port: number;
  host: string;
  /** When set, requests must use /mcp/<token> or send `Authorization: Bearer <token>`. */
  authToken?: string;
}

const MAX_BODY = 4 * 1024 * 1024;

function sameSecret(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function authorized(req: http.IncomingMessage, path: string, token?: string): boolean {
  if (!token) return path === "/mcp";
  if (path.startsWith("/mcp/")) return sameSecret(decodeURIComponent(path.slice(5)), token);
  const header = req.headers.authorization ?? "";
  return path === "/mcp" && header.startsWith("Bearer ") && sameSecret(header.slice(7), token);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("Request body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function rpcError(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

/**
 * Serves MCP over Streamable HTTP in stateless mode: every POST gets its own
 * server and transport, while API clients (caches, tokens, quotas) are shared.
 */
export function startHttpServer(services: Services, opts: HttpOptions): Promise<http.Server> {
  const httpServer = http.createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname.replace(/\/+$/, "") || "/";

    if (path === "/healthz" || path === "/") {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("ok");
    }
    if (path !== "/mcp" && !path.startsWith("/mcp/")) return rpcError(res, 404, "Not found");
    if (!authorized(req, path, opts.authToken)) return rpcError(res, 401, "Unauthorized");
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return rpcError(res, 405, "Method not allowed: this server is stateless and only accepts POST");
    }

    let body: unknown;
    try {
      body = await readBody(req);
    } catch (err) {
      return rpcError(res, 400, (err as Error).message);
    }

    const server = createServer(services);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (!res.headersSent) rpcError(res, 500, `Internal error: ${(err as Error).message}`);
    }
  });

  return new Promise((resolve) => httpServer.listen(opts.port, opts.host, () => resolve(httpServer)));
}
