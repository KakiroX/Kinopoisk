import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import * as fx from "./reddit-fixtures.js";
import { closeAll, connectStdio, startFake, text, Reply } from "./helpers.js";
import { parsePostRef } from "../src/reddit/parse.js";
import { RedditClient } from "../src/reddit/client.js";

let failNext429 = 0;
let fake: Awaited<ReturnType<typeof startFake>>;
let requests: Awaited<ReturnType<typeof startFake>>["requests"];
let base: string;

function route(path: string, q: URLSearchParams): unknown {
  const p = path.replace(/\.json$/, "");
  if (p === "/comments/abc123") return fx.thread;
  if (p === "/api/morechildren") {
    const ids = q.get("children")!.split(",");
    return { json: { errors: [], data: { things: fx.moreChildren.json.data.things.filter((t: any) => ids.includes(t.data.id) || t.data.id === "c7") } } };
  }
  if (p === "/r/test/new") {
    const after = q.get("after");
    const n = Number(q.get("limit"));
    if (!after) return fx.listingPage("p", 0, n, "t3_p99");
    return fx.listingPage("p", 100, Math.min(n, 30), null);
  }
  if (p === "/r/test/about") return fx.subredditAbout;
  if (p === "/r/test/about/rules") return fx.subredditRules;
  if (p === "/user/op_user/about") return fx.userAbout;
  if (p === "/user/op_user/overview") return fx.userOverview;
  if (p === "/search") return fx.listingPage("s", 0, 3, null);
  if (p.startsWith("/by_id/")) return { kind: "Listing", data: { children: p.slice(7).split(",").map((n) => ({ kind: "t3", data: { ...fx.post, id: n.slice(3) } })) } };
  return undefined;
}

before(async () => {
  fake = await startFake((path, q): Reply | undefined => {
    if (path === "/api/v1/access_token") return { body: { access_token: "tok123", expires_in: 3600 } };
    if (failNext429 > 0) {
      failNext429--;
      return { status: 429, headers: { "retry-after": "0", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "0" }, body: "Too Many Requests" };
    }
    const body = route(path, q);
    return body === undefined ? undefined : { headers: { "x-ratelimit-remaining": "99", "x-ratelimit-reset": "60" }, body };
  });
  ({ base, requests } = fake);
});

after(async () => {
  await closeAll();
  fake.close();
});

const connect = (extraEnv: Record<string, string> = {}) => connectStdio({ REDDIT_PUBLIC_BASE: base, ...extraEnv });

test("lists all tools", async () => {
  const c = await connect();
  const names = (await c.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "reddit_get_posts",
    "reddit_get_subreddit_comments",
    "reddit_get_subreddit_info",
    "reddit_get_subreddit_posts",
    "reddit_get_thread",
    "reddit_get_user",
    "reddit_get_user_content",
    "reddit_search",
    "reddit_search_subreddits",
  ]);
  await c.close();
});

test("thread: builds the tree and expands 'more' stubs into the right parents", async () => {
  const c = await connect();
  const r = await c.callTool({ name: "reddit_get_thread", arguments: { url_or_id: "https://old.reddit.com/r/test/comments/abc123/whatever/", format: "json" } });
  const t = JSON.parse(text(r));
  assert.equal(t.post.title, "Test thread title");
  assert.equal(t.loaded, 7);
  assert.deepEqual(t.comments.map((c: any) => c.id), ["c1", "c4", "c5", "c6"]);
  assert.deepEqual(t.comments[0].replies.map((c: any) => c.id), ["c2", "c3"]);
  assert.equal(t.comments[0].replies[0].is_op, true);
  assert.equal(t.comments[0].more, undefined);
  assert.equal(t.comments[1].continue_thread, true);
  assert.deepEqual(t.comments[2].replies.map((c: any) => c.id), ["c7"]);
  assert.equal(t.unloaded_top_level, undefined);
  // public mode uses .json paths
  assert.ok(requests.some((q) => q.path === "/comments/abc123.json"));
  await c.close();
});

test("thread: text output and expand_more=false", async () => {
  const c = await connect();
  const out = text(await c.callTool({ name: "reddit_get_thread", arguments: { url_or_id: "abc123", expand_more: false } }));
  assert.match(out, /## Test thread title/);
  assert.match(out, /u\/op_user · \[OP\]/);
  assert.match(out, /\[1 more replies not loaded\]/);
  assert.match(out, /2 top-level comments not loaded/);
  assert.match(out, /thread continues: use comment_id=c4/);
  await c.close();
});

test("listings paginate past 100 items using after cursors", async () => {
  const c = await connect();
  const before = requests.length;
  const r = await c.callTool({ name: "reddit_get_subreddit_posts", arguments: { subreddit: "r/test", sort: "new", limit: 130, format: "json" } });
  const page = JSON.parse(text(r));
  assert.equal(page.items.length, 130);
  assert.equal(page.after, null);
  const calls = requests.slice(before).filter((q) => q.path === "/r/test/new.json");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].query.get("after"), "t3_p99");
  await c.close();
});

test("retries after 429", async () => {
  const c = await connect();
  failNext429 = 2;
  const r = await c.callTool({ name: "reddit_get_subreddit_info", arguments: { subreddit: "test" } });
  assert.equal(r.isError, undefined);
  assert.match(text(r), /r\/test — Testing subreddit/);
  assert.match(text(r), /1\. Be nice: No insults\./);
  await c.close();
});

test("user, search, posts by id, and 404 errors", async () => {
  const c = await connect();
  const user = text(await c.callTool({ name: "reddit_get_user", arguments: { username: "u/op_user", recent: 5 } }));
  assert.match(user, /1500 comment karma/);
  assert.match(user, /User comment/);
  const search = text(await c.callTool({ name: "reddit_search", arguments: { query: "hello" } }));
  assert.match(search, /Post 2/);
  assert.equal(requests.at(-1)!.query.get("q"), "hello");
  const posts = JSON.parse(text(await c.callTool({ name: "reddit_get_posts", arguments: { posts: ["abc123", "https://redd.it/xyz789"], format: "json" } })));
  assert.deepEqual(posts.map((p: any) => p.id), ["abc123", "xyz789"]);
  const missing = await c.callTool({ name: "reddit_get_subreddit_info", arguments: { subreddit: "nope" } });
  assert.equal(missing.isError, true);
  assert.match(text(missing), /404/);
  await c.close();
});

test("OAuth mode sends a bearer token to the oauth host without .json", async () => {
  const c = await connect({ REDDIT_CLIENT_ID: "id", REDDIT_CLIENT_SECRET: "secret", REDDIT_OAUTH_BASE: base, REDDIT_TOKEN_URL: `${base}/api/v1/access_token` });
  const before = requests.length;
  await c.callTool({ name: "reddit_get_subreddit_info", arguments: { subreddit: "test" } });
  const req = requests.slice(before).find((q) => q.path === "/r/test/about")!;
  assert.equal(req.auth, "Bearer tok123");
  await c.close();
});

test("parsePostRef handles the common URL forms", () => {
  assert.deepEqual(parsePostRef("t3_abc123"), { postId: "abc123" });
  assert.deepEqual(parsePostRef("https://redd.it/abc123"), { postId: "abc123" });
  assert.deepEqual(parsePostRef("reddit.com/r/x/comments/abc123/slug/def456/?context=3"), { postId: "abc123", commentId: "def456" });
  assert.deepEqual(parsePostRef("https://www.reddit.com/comments/abc123"), { postId: "abc123", commentId: undefined });
  assert.equal(parsePostRef("https://www.reddit.com/r/x/s/AbCdEf").shareUrl, "https://www.reddit.com/r/x/s/AbCdEf");
  assert.throws(() => parsePostRef("https://example.com/foo"));
});

test("client waits for the rate-limit window instead of failing", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return new Response("{}", { status: 200, headers: { "x-ratelimit-remaining": calls === 1 ? "0" : "50", "x-ratelimit-reset": "1" } });
  }) as typeof fetch;
  const rc = new RedditClient({ userAgent: "t", fetchImpl, cacheTtlMs: 0 });
  await rc.get("/a");
  const start = Date.now();
  await rc.get("/b");
  assert.ok(Date.now() - start >= 900, "second request should wait for the reset");
});

test("unset options fall back to defaults", async () => {
  let seen = "";
  const fetchImpl = (async (url: string) => {
    seen = url;
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const rc = new RedditClient({ userAgent: "t", fetchImpl, publicBase: undefined, cacheTtlMs: undefined });
  await rc.get("/r/test/about");
  assert.match(seen, /^https:\/\/www\.reddit\.com\/r\/test\/about\.json/);
});
