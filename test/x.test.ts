import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { closeAll, connectStdio, startFake, text, Reply } from "./helpers.js";
import { buildThread, cleanUsername, parsePost, parsePostId } from "../src/x/parse.js";

const users = {
  u1: { id: "u1", username: "alice", name: "Alice" },
  u2: { id: "u2", username: "bob", name: "Bob" },
  u3: { id: "u3", username: "carol", name: "Carol" },
};

const tweet = (id: string, author: keyof typeof users, text: string, extra: any = {}) => ({
  id,
  author_id: author,
  text,
  created_at: `2026-10-29T10:00:${id.slice(-2)}.000Z`,
  conversation_id: "1000",
  public_metrics: { like_count: 5, retweet_count: 1, reply_count: 2, quote_count: 0, impression_count: 100 },
  ...extra,
});
const reply = (id: string, author: keyof typeof users, to: string, text: string) =>
  tweet(id, author, text, { referenced_tweets: [{ type: "replied_to", id: to }] });

const root = tweet("1000", "u1", "Root post (truncated)", {
  note_tweet: { text: "Root post with the full long text" },
  attachments: { media_keys: ["m1"] },
  entities: { urls: [{ expanded_url: "https://example.com/article" }] },
});

let failNext429 = 0;
let fake: Awaited<ReturnType<typeof startFake>>;

function route(path: string, q: URLSearchParams): Reply | undefined {
  const inc = { users: Object.values(users), media: [{ media_key: "m1", type: "photo", url: "https://pbs.twimg.com/a.jpg" }] };
  if (failNext429 > 0) {
    failNext429--;
    return { status: 429, headers: { "x-rate-limit-reset": String(Math.ceil(Date.now() / 1000) + 1) }, body: { title: "Too Many Requests" } };
  }
  if (q.get("max_results") && Number(q.get("max_results")) < 5) return { status: 400, body: { detail: "max_results too small" } };
  switch (path) {
    case "/2/tweets/1000":
      return { body: { data: root, includes: inc } };
    case "/2/tweets/1003":
      return { body: { data: reply("1003", "u3", "1002", "Carol answers Bob"), includes: inc } };
    case "/2/tweets/2000":
      return {
        body: {
          data: tweet("2000", "u2", "Look at this", { conversation_id: "2000", referenced_tweets: [{ type: "quoted", id: "1000" }] }),
          includes: { ...inc, tweets: [root] },
        },
      };
    case "/2/tweets/9999":
      return { body: { errors: [{ detail: "Could not find tweet with id: [9999]." }] } };
    case "/2/tweets/search/recent":
      if (q.get("query") !== "conversation_id:1000") return { body: { meta: { result_count: 0 } } };
      if (!q.get("next_token"))
        return {
          body: {
            data: [reply("1001", "u1", "1000", "Thread continues 2/2"), reply("1002", "u2", "1000", "Bob replies")],
            includes: inc,
            meta: { next_token: "pg2" },
          },
        };
      return { body: { data: [reply("1003", "u3", "1002", "Carol answers Bob"), reply("1004", "u2", "5555", "Reply to a missing post")], includes: inc, meta: {} } };
    case "/2/users/by/username/alice":
      return {
        body: {
          data: {
            ...users.u1,
            description: "Bio here",
            created_at: "2010-01-01T00:00:00.000Z",
            public_metrics: { followers_count: 12345, following_count: 10, tweet_count: 999 },
          },
        },
      };
    case "/2/users/u1/tweets":
      return { body: { data: [tweet("1100", "u1", "Recent one"), tweet("1101", "u1", "Recent two")], includes: inc, meta: {} } };
    case "/2/users/by/username/nobody":
      return { status: 401, body: { title: "Unauthorized", detail: "Unauthorized" } };
  }
  return undefined;
}

before(async () => {
  fake = await startFake(route);
});
after(async () => {
  await closeAll();
  fake.close();
});

const connect = (env: Record<string, string> = {}) =>
  connectStdio({ X_BEARER_TOKEN: "xtok", X_API_BASE: `${fake.base}/2`, REDDIT_PUBLIC_BASE: fake.base, ...env });

test("X tools are registered only when a bearer token is set", async () => {
  const withX = await connect();
  const names = (await withX.listTools()).tools.map((t) => t.name);
  for (const n of ["x_get_post", "x_get_posts", "x_get_thread", "x_search", "x_get_user", "x_get_user_posts", "x_get_quotes"]) assert.ok(names.includes(n), n);
  await withX.close();

  const without = await connectStdio({ REDDIT_PUBLIC_BASE: fake.base });
  assert.ok(!(await without.listTools()).tools.some((t) => t.name.startsWith("x_")));
  await without.close();
});

test("x_get_post: full long-post text, media, links, bearer auth", async () => {
  const c = await connect();
  const out = text(await c.callTool({ name: "x_get_post", arguments: { url_or_id: "https://twitter.com/alice/status/1000?s=20" } }));
  assert.match(out, /@alice \(Alice\)/);
  assert.match(out, /Root post with the full long text/);
  assert.match(out, /media: photo https:\/\/pbs\.twimg\.com\/a\.jpg/);
  assert.match(out, /links: https:\/\/example\.com\/article/);
  assert.match(out, /X post reads today: 1\/1000/);
  assert.equal(fake.requests.at(-1)!.auth, "Bearer xtok");
  assert.match(fake.requests.at(-1)!.query.get("expansions")!, /author_id/);
  await c.close();
});

test("x_get_post: quoted posts are inlined; missing posts are errors", async () => {
  const c = await connect();
  const out = text(await c.callTool({ name: "x_get_post", arguments: { url_or_id: "2000" } }));
  assert.match(out, /quoting:\n\s+- @alice/);
  const missing = await c.callTool({ name: "x_get_post", arguments: { url_or_id: "9999" } });
  assert.equal(missing.isError, true);
  assert.match(text(missing), /Could not find tweet/);
  await c.close();
});

test("x_get_thread: builds the reply tree from any post in the conversation", async () => {
  const c = await connect();
  const t = JSON.parse(text(await c.callTool({ name: "x_get_thread", arguments: { url_or_id: "https://x.com/carol/status/1003", format: "json" } })));
  assert.equal(t.tree.id, "1000");
  assert.equal(t.focused_id, "1003");
  assert.equal(t.loaded, 4);
  assert.equal(t.orphans, 1);
  // Author's own continuation first, then other replies chronologically, then orphans.
  assert.deepEqual(t.tree.children.map((n: any) => n.id), ["1001", "1002", "1004"]);
  assert.deepEqual(t.tree.children[1].children.map((n: any) => n.id), ["1003"]);
  const searches = fake.requests.filter((r) => r.path === "/2/tweets/search/recent");
  assert.equal(searches.at(-1)!.query.get("next_token"), "pg2");
  await c.close();
});

test("x_get_user includes recent posts, excluding replies by default", async () => {
  const c = await connect();
  const out = text(await c.callTool({ name: "x_get_user", arguments: { username: "@alice", recent: 2 } }));
  assert.match(out, /## @alice \(Alice\)/);
  assert.match(out, /12,345 followers/);
  assert.match(out, /Recent two/);
  const call = fake.requests.find((r) => r.path === "/2/users/u1/tweets")!;
  assert.equal(call.query.get("exclude"), "replies");
  assert.equal(call.query.get("max_results"), "5");
  await c.close();
});

test("429 waits for x-rate-limit-reset, then succeeds", async () => {
  const c = await connect();
  failNext429 = 1;
  const r = await c.callTool({ name: "x_get_post", arguments: { url_or_id: "1000" } });
  assert.equal(r.isError, undefined);
  await c.close();
});

test("daily post cap stops further billed reads", async () => {
  const c = await connect({ X_DAILY_POST_LIMIT: "1" });
  assert.equal((await c.callTool({ name: "x_get_post", arguments: { url_or_id: "1000" } })).isError, undefined);
  const blocked = await c.callTool({ name: "x_get_post", arguments: { url_or_id: "2000" } });
  assert.equal(blocked.isError, true);
  assert.match(text(blocked), /Daily cap of 1 post reads/);
  await c.close();
});

test("401 explains the token problem", async () => {
  const c = await connect();
  const r = await c.callTool({ name: "x_get_user", arguments: { username: "nobody" } });
  assert.equal(r.isError, true);
  assert.match(text(r), /X_BEARER_TOKEN/);
  await c.close();
});

test("parsing helpers", () => {
  assert.equal(parsePostId("https://x.com/user/status/123456789"), "123456789");
  assert.equal(parsePostId("https://mobile.twitter.com/user/status/123456789/photo/1"), "123456789");
  assert.equal(parsePostId("https://fxtwitter.com/user/status/123456789"), "123456789");
  assert.equal(parsePostId("https://x.com/i/web/status/123456789"), "123456789");
  assert.equal(parsePostId("123456789"), "123456789");
  assert.throws(() => parsePostId("https://example.com/status/1"));
  assert.equal(cleanUsername("@jack"), "jack");
  assert.equal(cleanUsername("https://x.com/jack/with_replies"), "jack");

  const rt = parsePost(
    { id: "5", author_id: "u2", text: "RT @alice: trunc…", referenced_tweets: [{ type: "retweeted", id: "1000" }] },
    { users: Object.values(users), tweets: [root] },
  );
  assert.equal(rt.reposted?.text, "Root post with the full long text");

  const { tree } = buildThread(parsePost(root, { users: Object.values(users) }), []);
  assert.deepEqual(tree.children, []);
});
