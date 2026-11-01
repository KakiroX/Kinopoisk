import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { bodyLimit, format, json, run } from "../common.js";
import { RedditService } from "./service.js";
import { renderComments, renderListingItem, renderPost } from "./parse.js";

const time = z.enum(["hour", "day", "week", "month", "year", "all"]);
const limit = (def: number, max = 1000) =>
  z.number().int().min(1).max(max).default(def).describe(`Number of items (pages through results automatically, max ${max}).`);
const after = z.string().optional().describe("Pagination cursor returned as `after` by a previous call.");

const pageFooter = (n: number, cursor: string | null) =>
  `\n\n${n} items. ${cursor ? `More available: after="${cursor}"` : "End of listing."}`;

export function registerRedditTools(server: McpServer, reddit: RedditService): void {
  server.registerTool(
    "reddit_get_thread",
    {
      title: "Get Reddit thread",
      description:
        "Fetch a Reddit post with its full comment tree. Accepts a post URL, comment permalink, redd.it or share link, or post id. " +
        "Collapsed 'load more comments' branches are expanded automatically.",
      inputSchema: {
        url_or_id: z.string().describe("Post URL, comment permalink, redd.it link, /s/ share link, or post id like 1abcde2"),
        comment_id: z.string().optional().describe("Focus on this comment's sub-thread (also taken from comment permalinks)."),
        context: z.number().int().min(0).max(8).optional().describe("With comment_id: number of parent comments to include."),
        sort: z.enum(["confidence", "top", "new", "controversial", "old", "qa"]).optional().describe("Comment sort (default: Reddit's 'best')."),
        comment_limit: z.number().int().min(1).max(10000).optional().describe("Stop after roughly this many comments."),
        depth: z.number().int().min(1).max(50).optional().describe("Maximum reply depth."),
        expand_more: z.boolean().default(true).describe("Load collapsed 'more comments' branches."),
        max_more_requests: z.number().int().min(0).max(100).default(10).describe("Cap on extra requests (100 comments each) for expanding."),
        body_limit: bodyLimit,
        format,
      },
    },
    (a) =>
      run(async () => {
        const t = await reddit.getThread({
          ref: a.url_or_id,
          commentId: a.comment_id,
          context: a.context,
          sort: a.sort,
          limit: a.comment_limit,
          depth: a.depth,
          expandMore: a.expand_more,
          maxMoreRequests: a.max_more_requests,
        });
        if (a.format === "json") return json(t);
        const notes = [`${t.loaded} comments loaded of ${t.post.num_comments} reported by Reddit.`];
        if (t.unloaded_top_level) notes.push(`${t.unloaded_top_level} top-level comments not loaded (raise max_more_requests).`);
        if (t.focused_comment) notes.push(`Focused on comment ${t.focused_comment}.`);
        return `${renderPost(t.post, { bodyLimit: a.body_limit })}\n\n### Comments\n${notes.join(" ")}\n\n${renderComments(t.comments, { bodyLimit: a.body_limit })}`;
      }),
  );

  server.registerTool(
    "reddit_get_posts",
    {
      title: "Get Reddit posts by id",
      description: "Fetch metadata for many posts at once (score, comment count, text) by URL or id, without comments.",
      inputSchema: {
        posts: z.array(z.string()).min(1).max(1000).describe("Post URLs or ids."),
        body_limit: bodyLimit,
        format,
      },
    },
    (a) =>
      run(async () => {
        const posts = await reddit.getPostsById(a.posts);
        if (a.format === "json") return json(posts);
        return posts.map((p) => renderListingItem(p, { bodyLimit: a.body_limit })).join("\n");
      }),
  );

  server.registerTool(
    "reddit_get_subreddit_posts",
    {
      title: "List subreddit posts",
      description: "List posts in a subreddit (hot, new, top, rising, controversial). Use 'all' or 'popular' as the subreddit for front pages.",
      inputSchema: {
        subreddit: z.string().describe("Subreddit name, with or without r/, or its URL."),
        sort: z.enum(["hot", "new", "top", "rising", "controversial"]).default("hot"),
        time: time.default("day").describe("Time window for top/controversial."),
        limit: limit(25),
        after,
        body_limit: bodyLimit,
        format,
      },
    },
    (a) =>
      run(async () => {
        const page = await reddit.subredditPosts({ subreddit: a.subreddit, sort: a.sort, time: a.time, limit: a.limit, after: a.after });
        if (a.format === "json") return json(page);
        return page.items.map((p) => renderListingItem(p, { bodyLimit: a.body_limit })).join("\n") + pageFooter(page.items.length, page.after);
      }),
  );

  server.registerTool(
    "reddit_get_subreddit_comments",
    {
      title: "Latest subreddit comments",
      description: "Stream of the newest comments across all posts in a subreddit.",
      inputSchema: { subreddit: z.string(), limit: limit(50), after, body_limit: bodyLimit, format },
    },
    (a) =>
      run(async () => {
        const page = await reddit.subredditComments({ subreddit: a.subreddit, limit: a.limit, after: a.after });
        if (a.format === "json") return json(page);
        return page.items.map((c) => renderListingItem(c, { bodyLimit: a.body_limit })).join("\n") + pageFooter(page.items.length, page.after);
      }),
  );

  server.registerTool(
    "reddit_search",
    {
      title: "Search Reddit posts",
      description:
        "Search posts across Reddit or within one subreddit. Supports Reddit search syntax: title:, author:, selftext:, site:, url:, flair:, self:yes, nsfw:no, AND/OR/NOT.",
      inputSchema: {
        query: z.string().min(1),
        subreddit: z.string().optional().describe("Restrict to this subreddit."),
        sort: z.enum(["relevance", "hot", "top", "new", "comments"]).default("relevance"),
        time: time.default("all"),
        limit: limit(25),
        after,
        body_limit: bodyLimit,
        format,
      },
    },
    (a) =>
      run(async () => {
        const page = await reddit.search({ query: a.query, subreddit: a.subreddit, sort: a.sort, time: a.time, limit: a.limit, after: a.after });
        if (a.format === "json") return json(page);
        if (!page.items.length) return "No results.";
        return page.items.map((p) => renderListingItem(p, { bodyLimit: a.body_limit })).join("\n") + pageFooter(page.items.length, page.after);
      }),
  );

  server.registerTool(
    "reddit_search_subreddits",
    {
      title: "Find subreddits",
      description: "Find subreddits matching a topic, with subscriber counts and descriptions.",
      inputSchema: { query: z.string().min(1), limit: limit(15, 100), format },
    },
    (a) =>
      run(async () => {
        const subs = await reddit.searchSubreddits(a.query, a.limit);
        if (a.format === "json") return json(subs);
        if (!subs.length) return "No subreddits found.";
        return subs
          .map((s) => `- r/${s.name} · ${s.subscribers?.toLocaleString("en-US") ?? "?"} members${s.nsfw ? " · NSFW" : ""}\n  ${s.title}${s.description ? ` — ${s.description.replace(/\s+/g, " ").slice(0, 200)}` : ""}`)
          .join("\n");
      }),
  );

  server.registerTool(
    "reddit_get_subreddit_info",
    {
      title: "Subreddit info and rules",
      description: "Get a subreddit's description, member count, active users and rules.",
      inputSchema: { subreddit: z.string(), format },
    },
    (a) =>
      run(async () => {
        const s = await reddit.subredditInfo(a.subreddit);
        if (a.format === "json") return json(s);
        const rules = s.rules.map((r: { title: string; description?: string }, i: number) => `${i + 1}. ${r.title}${r.description ? `: ${r.description.replace(/\s+/g, " ")}` : ""}`);
        return [
          `## r/${s.name} — ${s.title}`,
          `${s.subscribers?.toLocaleString("en-US") ?? "?"} members · ${s.active_users?.toLocaleString("en-US") ?? "?"} online · created ${s.created}${s.nsfw ? " · NSFW" : ""}`,
          s.url,
          "",
          s.description,
          ...(rules.length ? ["", "### Rules", ...rules] : []),
        ].join("\n");
      }),
  );

  server.registerTool(
    "reddit_get_user",
    {
      title: "Reddit user profile",
      description: "Get a user's karma and account age, plus their most recent posts and comments.",
      inputSchema: {
        username: z.string().describe("Username, with or without u/."),
        recent: z.number().int().min(0).max(100).default(10).describe("How many recent posts/comments to include."),
        body_limit: bodyLimit,
        format,
      },
    },
    (a) =>
      run(async () => {
        const [user, recent] = await Promise.all([
          reddit.userInfo(a.username),
          a.recent ? reddit.userContent({ username: a.username, type: "overview", sort: "new", limit: a.recent }) : null,
        ]);
        if (a.format === "json") return json({ user, recent: recent?.items ?? [] });
        const head = [
          `## u/${user.name}${user.suspended ? " (suspended)" : ""}`,
          `created ${user.created} · ${user.link_karma} post karma · ${user.comment_karma} comment karma${user.is_mod ? " · moderator" : ""}${user.verified ? " · verified email" : ""}`,
        ];
        if (!recent?.items.length) return head.join("\n");
        return `${head.join("\n")}\n\n### Recent activity\n${recent.items.map((i) => renderListingItem(i, { bodyLimit: a.body_limit })).join("\n")}`;
      }),
  );

  server.registerTool(
    "reddit_get_user_content",
    {
      title: "User posts and comments",
      description: "Page through a user's submitted posts, comments, or both (overview).",
      inputSchema: {
        username: z.string(),
        type: z.enum(["overview", "submitted", "comments"]).default("overview"),
        sort: z.enum(["new", "hot", "top", "controversial"]).default("new"),
        time: time.default("all").describe("Time window for top/controversial."),
        limit: limit(25),
        after,
        body_limit: bodyLimit,
        format,
      },
    },
    (a) =>
      run(async () => {
        const page = await reddit.userContent({ username: a.username, type: a.type, sort: a.sort, time: a.time, limit: a.limit, after: a.after });
        if (a.format === "json") return json(page);
        return page.items.map((i) => renderListingItem(i, { bodyLimit: a.body_limit })).join("\n") + pageFooter(page.items.length, page.after);
      }),
  );
}
