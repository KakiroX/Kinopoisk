import { XClient } from "./client.js";
import { TWEET_PARAMS, USER_FIELDS, XPost, buildThread, cleanUsername, parsePostId, parsePosts, parseUser } from "./parse.js";

export interface XPage {
  posts: XPost[];
  /** Cursor for the next page, or null when there are no more results. */
  next_token: string | null;
}

export class XService {
  constructor(readonly client: XClient) {}

  /**
   * Follows `next_token` cursors until `limit` posts are collected. X enforces
   * a per-endpoint minimum page size, so small limits still fetch one full
   * minimum-size page.
   */
  private async paginate(
    path: string,
    params: Record<string, string | number | undefined>,
    opts: { limit: number; minPage: number; tokenParam: "next_token" | "pagination_token"; token?: string },
  ): Promise<XPage> {
    const posts: XPost[] = [];
    let token: string | null = opts.token ?? null;
    do {
      const pageSize = Math.min(100, Math.max(opts.minPage, opts.limit - posts.length));
      const body = await this.client.get(path, { ...TWEET_PARAMS, ...params, max_results: pageSize, [opts.tokenParam]: token ?? undefined });
      const page = parsePosts(body);
      posts.push(...page);
      token = body?.meta?.next_token ?? null;
      if (!page.length) break;
    } while (token && posts.length < opts.limit);
    return { posts: posts.slice(0, opts.limit), next_token: token };
  }

  async getPost(ref: string): Promise<XPost> {
    const body = await this.client.get(`/tweets/${parsePostId(ref)}`, TWEET_PARAMS);
    return parsePosts(body)[0];
  }

  async getPosts(refs: string[]): Promise<XPost[]> {
    const ids = refs.map(parsePostId);
    const out: XPost[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const body = await this.client.get("/tweets", { ...TWEET_PARAMS, ids: ids.slice(i, i + 100).join(",") });
      out.push(...parsePosts(body));
    }
    return out;
  }

  async getThread(opts: { ref: string; limit: number; archive: boolean }) {
    const focused = await this.getPost(opts.ref);
    const conversationId = focused.conversation_id ?? focused.id;
    const root = conversationId === focused.id ? focused : await this.getPost(conversationId).catch(() => focused);

    const page = await this.paginate(
      opts.archive ? "/tweets/search/all" : "/tweets/search/recent",
      { query: `conversation_id:${conversationId}`, sort_order: opts.archive ? undefined : "recency" },
      { limit: opts.limit, minPage: 10, tokenParam: "next_token" },
    );
    const { tree, orphans } = buildThread(root, page.posts);
    const ageDays = (Date.now() - Date.parse(root.created)) / 86_400_000;
    return {
      tree,
      focused_id: focused.id,
      loaded: page.posts.length,
      reported_replies: root.replies,
      orphans,
      more_available: page.next_token !== null,
      recent_search_window_missed: !opts.archive && ageDays > 7,
    };
  }

  search(opts: { query: string; limit: number; sort: "recency" | "relevancy"; archive: boolean; start_time?: string; end_time?: string; next_token?: string }) {
    return this.paginate(
      opts.archive ? "/tweets/search/all" : "/tweets/search/recent",
      { query: opts.query, sort_order: opts.sort, start_time: opts.start_time, end_time: opts.end_time },
      { limit: opts.limit, minPage: 10, tokenParam: "next_token", token: opts.next_token },
    );
  }

  async getUser(username: string) {
    const body = await this.client.get(`/users/by/username/${encodeURIComponent(cleanUsername(username))}`, { "user.fields": USER_FIELDS });
    return parseUser(body.data);
  }

  async userPosts(opts: { username: string; limit: number; exclude: string[]; pagination_token?: string; userId?: string }) {
    const id = opts.userId ?? (await this.getUser(opts.username)).id;
    return this.paginate(
      `/users/${id}/tweets`,
      { exclude: opts.exclude.length ? opts.exclude.join(",") : undefined },
      { limit: opts.limit, minPage: 5, tokenParam: "pagination_token", token: opts.pagination_token },
    );
  }

  quotes(opts: { ref: string; limit: number; pagination_token?: string }) {
    return this.paginate(
      `/tweets/${parsePostId(opts.ref)}/quote_tweets`,
      {},
      { limit: opts.limit, minPage: 10, tokenParam: "pagination_token", token: opts.pagination_token },
    );
  }
}
