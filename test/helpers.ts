import http from "node:http";
import { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface Recorded {
  method: string;
  path: string;
  query: URLSearchParams;
  auth?: string;
}

export interface Reply {
  status?: number;
  headers?: Record<string, string>;
  body: unknown;
}

/** Starts a local HTTP server standing in for a remote API. `route` returns undefined for 404. */
export async function startFake(route: (path: string, query: URLSearchParams, req: http.IncomingMessage) => Reply | undefined) {
  const requests: Recorded[] = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    requests.push({ method: req.method!, path: url.pathname, query: url.searchParams, auth: req.headers.authorization });
    const reply = route(url.pathname, url.searchParams, req);
    if (!reply) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end("{}");
    }
    res.writeHead(reply.status ?? 200, { "content-type": "application/json", ...reply.headers });
    res.end(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, requests, close: () => server.close() };
}

export const serverEntry = fileURLToPath(new URL("../src/index.js", import.meta.url));

const openClients = new Set<Client>();

/** Closes every client still open, so a failed assertion can't leave a server process running. */
export async function closeAll() {
  await Promise.all([...openClients].map((c) => c.close()));
  openClients.clear();
}

/** Spawns the real MCP server over stdio with the given environment. */
export async function connectStdio(env: Record<string, string>) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry],
    env: { PATH: process.env.PATH!, CACHE_TTL: "0", ...env },
    stderr: "ignore",
  });
  const client = new Client({ name: "test", version: "0" });
  await client.connect(transport);
  openClients.add(client);
  return client;
}

export const text = (r: any) => r.content[0].text as string;
