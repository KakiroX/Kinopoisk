import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { bodyLimit, format, json, run } from "../common.js";
import { XService, XPage } from "./service.js";
import { renderPost, renderThread, renderUser } from "./parse.js";

const archive = z
  .boolean()
  .default(false)
  .describe("Use full-archive search instead of the last 7 days. Needs an X plan with full-archive access.");

export function registerXTools(server: McpServer, x: XService): void {
  // Every X read is billed, so each result says how much of the daily cap is used.
  const usage = () => {
    const { used, limit } = x.client.postsReadToday;
    return limit > 0 ? `[X post reads today: ${used}/${limit}]` : `[X post reads today: ${used}]`;
  };
  const page = (p: XPage, opts: { bodyLimit?: number }, cursorName: string) =>
    `${p.posts.map((post) => renderPost(post, opts)).join("\n")}\n\n${p.posts.length} posts. ${
      p.next_token ? `More available: ${cursorName}="${p.next_token}"` : "No more results."
    } ${usage()}`;

  server.registerTool(
    "x_get_post",
    {
      title: "Get X post",
      description: "Fetch one X (Twitter) post by URL or id, including quoted/reposted posts, media and links. Long posts are returned in full.",
      inputSchema: { url_or_id: z.string().describe("x.com / twitter.com status URL or numeric post id."), format },
    },
    (a) =>
      run(async () => {
        const post = await x.getPost(a.url_or_id);
        return a.format === "json" ? json(post) : `${renderPost(post)}\n\n${usage()}`;
      }),
  );

  server.registerTool(
    "x_get_posts",
    {
      title: "Get X posts by id",
      description: "Fetch up to 500 X posts at once by URL or id (100 per request).",
      inputSchema: { posts: z.array(z.string()).min(1).max(500), body_limit: bodyLimit, format },
    },
    (a) =>
      run(async () => {
        const posts = await x.getPosts(a.posts);
        return a.format === "json" ? json(posts) : `${posts.map((p) => renderPost(p, { bodyLimit: a.body_limit })).join("\n")}\n\n${usage()}`;
      }),
  );

  server.registerTool(
    "x_get_thread",
    {
      title: "Get X conversation",
      description:
        "Fetch a whole X conversation as a reply tree: the original post, the author's thread continuation, and replies. " +
        "Accepts the URL of any post in the conversation.",
      inputSchema: {
        url_or_id: z.string(),
        limit: z.number().int().min(10).max(1000).default(100).describe("Maximum replies to fetch (each one is a billed read)."),
        archive: archive.describe("Search the full archive for replies. Without it, only replies from the last 7 days are found."),
        body_limit: bodyLimit,
        format,
      },
    },
    (a) =>
      run(async () => {
        const t = await x.getThread({ ref: a.url_or_id, limit: a.limit, archive: a.archive });
        if (a.format === "json") return json(t);
        const notes = [`${t.loaded} replies loaded${t.reported_replies !== undefined ? ` (X reports ${t.reported_replies} direct replies to the original post)` : ""}.`];
        if (t.focused_id !== t.tree.id) notes.push(`You asked for post ${t.focused_id}; showing its whole conversation.`);
        if (t.more_available) notes.push("More replies exist; raise limit to load them.");
        if (t.recent_search_window_missed) notes.push("The post is older than 7 days, so older replies are missing; use archive: true if your plan allows it.");
        if (t.orphans) notes.push(`${t.orphans} replies answer posts that were not loaded and are shown under the original post.`);
        return `${renderThread(t.tree, { bodyLimit: a.body_limit })}\n\n${notes.join(" ")} ${usage()}`;
      }),
  );

  server.registerTool(
    "x_search",
    {
      title: "Search X posts",
      description:
        "Search X posts. Supports X query operators: from:user, to:user, @mention, #hashtag, \"exact phrase\", -exclude, OR, lang:en, " +
        "is:reply, -is:retweet, has:media, has:links, url:domain, conversation_id:ID.",
      inputSchema: {
        query: z.string().min(1).max(4096),
        limit: z.number().int().min(1).max(1000).default(20).describe("Posts to return (pages automatically; each post is a billed read)."),
        sort: z.enum(["recency", "relevancy"]).default("relevancy"),
        archive,
        start_time: z.string().optional().describe("ISO 8601 timestamp, e.g. 2026-10-01T00:00:00Z"),
        end_time: z.string().optional().describe("ISO 8601 timestamp"),
        next_token: z.string().optional().describe("Cursor from a previous call."),
        body_limit: bodyLimit,
        format,
      },
    },
    (a) =>
      run(async () => {
        const p = await x.search({
          query: a.query,
          limit: a.limit,
          sort: a.sort,
          archive: a.archive,
          start_time: a.start_time,
          end_time: a.end_time,
          next_token: a.next_token,
        });
        if (a.format === "json") return json(p);
        if (!p.posts.length) return `No results. ${usage()}`;
        return page(p, { bodyLimit: a.body_limit }, "next_token");
      }),
  );

  server.registerTool(
    "x_get_user",
    {
      title: "X user profile",
      description: "Get an X user's bio, follower counts and join date, plus their most recent posts.",
      inputSchema: {
        username: z.string().describe("Handle with or without @, or profile URL."),
        recent: z.number().int().min(0).max(100).default(10).describe("Recent posts to include (billed reads)."),
        include_replies: z.boolean().default(false),
        body_limit: bodyLimit,
        format,
      },
    },
    (a) =>
      run(async () => {
        const user = await x.getUser(a.username);
        const recent = a.recent
          ? await x.userPosts({ username: user.username, userId: user.id, limit: a.recent, exclude: a.include_replies ? [] : ["replies"] })
          : null;
        if (a.format === "json") return json({ user, recent: recent?.posts ?? [] });
        const posts = recent?.posts.length ? `\n\n### Recent posts\n${recent.posts.map((p) => renderPost(p, { bodyLimit: a.body_limit })).join("\n")}` : "";
        return `${renderUser(user)}${posts}\n\n${usage()}`;
      }),
  );

  server.registerTool(
    "x_get_user_posts",
    {
      title: "X user timeline",
      description: "Page through a user's posts, newest first (X returns up to their latest 3200).",
      inputSchema: {
        username: z.string(),
        limit: z.number().int().min(1).max(3200).default(20),
        exclude: z.array(z.enum(["replies", "retweets"])).default([]).describe("Leave out replies and/or reposts."),
        pagination_token: z.string().optional(),
        body_limit: bodyLimit,
        format,
      },
    },
    (a) =>
      run(async () => {
        const p = await x.userPosts({ username: a.username, limit: a.limit, exclude: a.exclude, pagination_token: a.pagination_token });
        return a.format === "json" ? json(p) : page(p, { bodyLimit: a.body_limit }, "pagination_token");
      }),
  );

  server.registerTool(
    "x_get_quotes",
    {
      title: "X quote posts",
      description: "List posts that quote a given post.",
      inputSchema: {
        url_or_id: z.string(),
        limit: z.number().int().min(1).max(1000).default(20),
        pagination_token: z.string().optional(),
        body_limit: bodyLimit,
        format,
      },
    },
    (a) =>
      run(async () => {
        const p = await x.quotes({ ref: a.url_or_id, limit: a.limit, pagination_token: a.pagination_token });
        if (a.format === "json") return json(p);
        if (!p.posts.length) return `No quote posts found. ${usage()}`;
        return page(p, { bodyLimit: a.body_limit }, "pagination_token");
      }),
  );
}
