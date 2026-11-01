#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AddressInfo } from "node:net";
import { startHttpServer } from "./http.js";
import { createServer, createServices } from "./server.js";

const env = process.env;
const services = createServices(env);
const sources = [
  `Reddit (${services.reddit.client.authenticated ? "OAuth" : "public JSON, unauthenticated"})`,
  services.x ? "X (API v2)" : "X disabled: set X_BEARER_TOKEN",
].join(", ");

if (process.argv.includes("--http") || env.MCP_TRANSPORT === "http") {
  const authToken = env.MCP_AUTH_TOKEN || undefined;
  const server = await startHttpServer(services, {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "0.0.0.0",
    authToken,
  });
  const { port } = server.address() as AddressInfo;
  const path = authToken ? "/mcp/<MCP_AUTH_TOKEN>" : "/mcp";
  console.error(`social-mcp listening on http://localhost:${port}${path} — ${sources}`);
  if (!authToken) console.error("WARNING: MCP_AUTH_TOKEN is not set; anyone who can reach this port can use your API credentials.");
} else {
  await createServer(services).connect(new StdioServerTransport());
  console.error(`social-mcp running on stdio — ${sources}`);
}
