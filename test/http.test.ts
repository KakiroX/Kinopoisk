import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startHttpServer } from "../src/http.js";
import { createServices } from "../src/server.js";
import { startFake, text } from "./helpers.js";

let server: http.Server;
let fake: Awaited<ReturnType<typeof startFake>>;
let base: string;

before(async () => {
  fake = await startFake((path) =>
    path === "/r/test/about.json"
      ? { body: { kind: "t5", data: { display_name: "test", title: "T", public_description: "d", subscribers: 1, created_utc: 1, url: "/r/test/" } } }
      : undefined,
  );
  const services = createServices({ REDDIT_PUBLIC_BASE: fake.base, CACHE_TTL: "0" });
  server = await startHttpServer(services, { port: 0, host: "127.0.0.1", authToken: "s3cret" });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  fake.close();
});

async function connect(url: string, headers: Record<string, string> = {}) {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }));
  return client;
}

test("secret path works as a claude.ai connector URL", async () => {
  const c = await connect(`${base}/mcp/s3cret`);
  const tools = (await c.listTools()).tools.map((t) => t.name);
  assert.ok(tools.includes("reddit_get_thread"));
  const r = await c.callTool({ name: "reddit_get_subreddit_info", arguments: { subreddit: "test" } });
  assert.match(text(r), /## r\/test — T/);
  await c.close();
});

test("bearer header works on /mcp", async () => {
  const c = await connect(`${base}/mcp`, { Authorization: "Bearer s3cret" });
  assert.ok((await c.listTools()).tools.length > 0);
  await c.close();
});

test("wrong or missing token is rejected", async () => {
  for (const [url, headers] of [
    [`${base}/mcp`, {}],
    [`${base}/mcp/wrong`, {}],
    [`${base}/mcp`, { Authorization: "Bearer nope" }],
  ] as const) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(res.status, 401, url);
  }
});

test("health check and GET on the MCP endpoint", async () => {
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await fetch(`${base}/mcp/s3cret`)).status, 405);
});
