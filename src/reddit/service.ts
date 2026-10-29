import { RedditClient } from "./client.js";
import {
  Comment,
  Post,
  buildTree,
  cleanSubreddit,
  cleanUsername,
  countComments,
  insertMoreChildren,
  parsePost,
  parsePostRef,
  parseSubreddit,
  parseThing,
  parseUser,
  takeMoreIds,
} from "./parse.js";

export type Time = "hour" | "day" | "week" | "month" | "year" | "all";

export interface Page<T> {
  items: T[];
  /** Cursor for the next page, or null when the listing is exhausted. */
  after: string | null;
}

export interface Thread {
  post: Post;
  comments: Comment[];
  loaded: number;
  /** Top-level comments Reddit still has that were not loaded. */
  unloaded_top_level?: number;
  focused_comment?: string;
}

const PAGE_SIZE = 100;

export class RedditService {
  constructor(readonly client: RedditClient) {}

  /**
   * Fetches a listing, following `after` cursors until `limit` items are
   * collected or Reddit runs out (Reddit stops listings at about 1000 items).
   */
  async listing(path: string, params: Record<string, string | number | undefined>, limit: number, after?: string) {
    const items: any[] = [];
    let cursor: string | null = after ?? null;
    do {
      const res = await this.client.get(path, { ...params, limit: Math.min(PAGE_SIZE, limit - items.length), after: cursor ?? undefined });
      const data = res?.data;
      if (!data?.children) break;
      items.push(...data.children);
      cursor = data.after ?? null;
      if (data.children.length === 0) break;
    } while (cursor && items.length < limit);
    return { items: items.slice(0, limit), after: cursor };
  }

  async getThread(opts: {
    ref: string;
    commentId?: string;
    context?: number;
    sort?: string;
    limit?: number;
    depth?: number;
    expandMore?: boolean;
    maxMoreRequests?: number;
  }): Promise<Thread> {
    let ref = parsePostRef(opts.ref);
    if (ref.shareUrl) ref = parsePostRef(await this.resolveShareLink(ref.shareUrl));
    const commentId = opts.commentId ?? ref.commentId;

    const res = await this.client.get(`/comments/${ref.postId}`, {
      comment: commentId,
      sort: opts.sort,
      limit: opts.limit,
      depth: opts.depth,
      context: commentId ? opts.context : undefined,
      showmore: true,
    });
    if (!Array.isArray(res) || !res[0]?.data?.children?.[0]) throw new Error(`Post ${ref.postId} not found.`);

    const post = parsePost(res[0].data.children[0].data);
    const tree = buildTree(res[1]?.data?.children ?? [], post.author);
    let rootMore = tree.rootMore;

    if (opts.expandMore !== false) {
      const linkFullname = `t3_${post.id}`;
      for (let i = 0; i < (opts.maxMoreRequests ?? 10); i++) {
        if (opts.limit && countComments(tree.roots) >= opts.limit) break;
        const taken = takeMoreIds(tree.roots, rootMore, 100);
        rootMore = taken.rootMore;
        if (taken.ids.length === 0) break;
        const things = await this.moreChildren(linkFullname, taken.ids, opts.sort, opts.depth);
        insertMoreChildren(tree.roots, things, post.author, linkFullname, (m) => {
          rootMore = rootMore ? { count: rootMore.count + m.count, children: [...rootMore.children, ...m.children] } : m;
        });
      }
    }

    const thread: Thread = { post, comments: tree.roots, loaded: countComments(tree.roots) };
    if (rootMore) thread.unloaded_top_level = rootMore.children.length;
    if (commentId) thread.focused_comment = commentId;
    return thread;
  }

  private async moreChildren(linkFullname: string, ids: string[], sort?: string, depth?: number): Promise<any[]> {
    const res = await this.client.get("/api/morechildren", {
      api_type: "json",
      link_id: linkFullname,
      children: ids.join(","),
      sort,
      depth,
      limit_children: false,
    });
    return res?.json?.data?.things ?? [];
  }

  private async resolveShareLink(url: string): Promise<string> {
    const res = await fetch(url, { method: "HEAD", redirect: "follow", headers: { "User-Agent": "reddit-mcp" } });
    if (!res.url.includes("/comments/")) throw new Error(`Could not resolve share link ${url}.`);
    return res.url;
  }

  async getPostsById(refs: string[]): Promise<Post[]> {
    const ids = refs.map((r) => `t3_${parsePostRef(r).postId}`);
    const posts: Post[] = [];
    for (let i = 0; i < ids.length; i += PAGE_SIZE) {
      const res = await this.client.get(`/by_id/${ids.slice(i, i + PAGE_SIZE).join(",")}`);
      posts.push(...(res?.data?.children ?? []).map((t: any) => parsePost(t.data)));
    }
    return posts;
  }

  async subredditPosts(opts: { subreddit: string; sort: string; time?: Time; limit: number; after?: string }): Promise<Page<Post>> {
    const sub = cleanSubreddit(opts.subreddit);
    const timed = opts.sort === "top" || opts.sort === "controversial";
    const res = await this.listing(`/r/${sub}/${opts.sort}`, { t: timed ? opts.time : undefined }, opts.limit, opts.after);
    return { items: res.items.map((t) => parsePost(t.data)), after: res.after };
  }

  async subredditComments(opts: { subreddit: string; limit: number; after?: string }): Promise<Page<Comment>> {
    const sub = cleanSubreddit(opts.subreddit);
    const res = await this.listing(`/r/${sub}/comments`, {}, opts.limit, opts.after);
    return { items: res.items.map((t) => parseThing(t) as Comment), after: res.after };
  }

  async search(opts: {
    query: string;
    subreddit?: string;
    sort?: string;
    time?: Time;
    limit: number;
    after?: string;
  }): Promise<Page<Post>> {
    const sub = opts.subreddit ? cleanSubreddit(opts.subreddit) : undefined;
    const path = sub ? `/r/${sub}/search` : "/search";
    const res = await this.listing(
      path,
      { q: opts.query, sort: opts.sort, t: opts.time, restrict_sr: sub ? "on" : undefined, type: "link" },
      opts.limit,
      opts.after,
    );
    return { items: res.items.map((t) => parsePost(t.data)), after: res.after };
  }

  async searchSubreddits(query: string, limit: number) {
    const res = await this.listing("/subreddits/search", { q: query }, limit);
    return res.items.map((t) => parseSubreddit(t.data));
  }

  async subredditInfo(name: string) {
    const sub = cleanSubreddit(name);
    const [about, rules] = await Promise.all([
      this.client.get(`/r/${sub}/about`),
      this.client.get(`/r/${sub}/about/rules`).catch(() => null),
    ]);
    if (about?.kind !== "t5") throw new Error(`r/${sub} not found.`);
    return {
      ...parseSubreddit(about.data),
      rules: (rules?.rules ?? []).map((r: any) => ({ title: r.short_name, description: r.description || undefined })),
    };
  }

  async userInfo(name: string) {
    const user = cleanUsername(name);
    const about = await this.client.get(`/user/${user}/about`);
    if (about?.kind !== "t2") throw new Error(`u/${user} not found.`);
    return parseUser(about.data);
  }

  async userContent(opts: {
    username: string;
    type: "overview" | "submitted" | "comments";
    sort?: string;
    time?: Time;
    limit: number;
    after?: string;
  }): Promise<Page<Post | Comment>> {
    const user = cleanUsername(opts.username);
    const timed = opts.sort === "top" || opts.sort === "controversial";
    const res = await this.listing(`/user/${user}/${opts.type}`, { sort: opts.sort, t: timed ? opts.time : undefined }, opts.limit, opts.after);
    return { items: res.items.map(parseThing), after: res.after };
  }
}
