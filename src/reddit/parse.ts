// Turns Reddit's "thing" JSON into compact objects and renders them for Claude.

import { indentText, truncate } from "../common.js";

export interface Post {
  id: string;
  subreddit: string;
  title: string;
  author: string;
  score: number;
  upvote_ratio?: number;
  num_comments: number;
  created: string;
  permalink: string;
  url?: string;
  domain?: string;
  flair?: string;
  selftext?: string;
  nsfw?: boolean;
  spoiler?: boolean;
  stickied?: boolean;
  locked?: boolean;
  crosspost_of?: string;
  gallery?: string[];
}

export interface Comment {
  id: string;
  author: string;
  score: number;
  created: string;
  body: string;
  depth: number;
  parent_id: string;
  is_op?: boolean;
  stickied?: boolean;
  edited?: boolean;
  flair?: string;
  replies: Comment[];
  /** Comment ids Reddit did not include ("load more comments"). */
  more?: { count: number; children: string[] };
  /** Thread continues on a separate page ("continue this thread"). */
  continue_thread?: boolean;
  /** Present on comments fetched from listings (user history, subreddit comment stream). */
  link_title?: string;
  subreddit?: string;
  permalink?: string;
}

export interface Subreddit {
  name: string;
  title: string;
  description: string;
  subscribers?: number;
  active_users?: number;
  created: string;
  nsfw?: boolean;
  url: string;
}

export interface User {
  name: string;
  created: string;
  link_karma: number;
  comment_karma: number;
  total_karma?: number;
  verified?: boolean;
  is_mod?: boolean;
  is_gold?: boolean;
  suspended?: boolean;
}

const iso = (utc?: number) => (utc ? new Date(utc * 1000).toISOString() : "");
const REDDIT = "https://www.reddit.com";

export function parsePost(d: any): Post {
  const post: Post = {
    id: d.id,
    subreddit: d.subreddit,
    title: d.title,
    author: d.author,
    score: d.score,
    upvote_ratio: d.upvote_ratio,
    num_comments: d.num_comments,
    created: iso(d.created_utc),
    permalink: REDDIT + d.permalink,
  };
  if (!d.is_self && d.url) post.url = d.url;
  if (!d.is_self && d.domain) post.domain = d.domain;
  if (d.link_flair_text) post.flair = d.link_flair_text;
  if (d.selftext) post.selftext = d.selftext;
  if (d.over_18) post.nsfw = true;
  if (d.spoiler) post.spoiler = true;
  if (d.stickied) post.stickied = true;
  if (d.locked) post.locked = true;
  if (d.crosspost_parent_list?.[0]) post.crosspost_of = REDDIT + d.crosspost_parent_list[0].permalink;
  if (d.is_gallery && d.media_metadata) {
    const order: string[] = d.gallery_data?.items?.map((i: any) => i.media_id) ?? Object.keys(d.media_metadata);
    post.gallery = order
      .map((id) => d.media_metadata[id]?.s?.u ?? d.media_metadata[id]?.s?.gif)
      .filter((u): u is string => Boolean(u));
  }
  return post;
}

export function parseComment(d: any, opAuthor?: string): Comment {
  const c: Comment = {
    id: d.id,
    author: d.author,
    score: d.score,
    created: iso(d.created_utc),
    body: d.body ?? "",
    depth: d.depth ?? 0,
    parent_id: d.parent_id,
    replies: [],
  };
  if (d.is_submitter || (opAuthor && d.author === opAuthor && d.author !== "[deleted]")) c.is_op = true;
  if (d.stickied) c.stickied = true;
  if (d.edited) c.edited = true;
  if (d.author_flair_text) c.flair = d.author_flair_text;
  if (d.link_title) {
    c.link_title = d.link_title;
    c.subreddit = d.subreddit;
  }
  if (d.permalink) c.permalink = REDDIT + d.permalink;
  return c;
}

export function parseSubreddit(d: any): Subreddit {
  return {
    name: d.display_name,
    title: d.title,
    description: d.public_description || d.description || "",
    subscribers: d.subscribers,
    active_users: d.active_user_count ?? d.accounts_active,
    created: iso(d.created_utc),
    nsfw: d.over18 || undefined,
    url: REDDIT + d.url,
  };
}

export function parseUser(d: any): User {
  return {
    name: d.name,
    created: iso(d.created_utc),
    link_karma: d.link_karma,
    comment_karma: d.comment_karma,
    total_karma: d.total_karma,
    verified: d.verified || undefined,
    is_mod: d.is_mod || undefined,
    is_gold: d.is_gold || undefined,
    suspended: d.is_suspended || undefined,
  };
}

/** Parses a listing of mixed things (t1 comments, t3 posts) as returned by user/overview endpoints. */
export function parseThing(thing: any): Post | Comment {
  return thing.kind === "t1" ? parseComment(thing.data) : parsePost(thing.data);
}

/**
 * Builds a comment tree from the second element of a /comments/{id} response.
 * Collapsed "more" stubs are attached to their parent (or the root list) so they
 * can be expanded later.
 */
export function buildTree(children: any[], opAuthor?: string): { roots: Comment[]; rootMore?: Comment["more"] } {
  const roots: Comment[] = [];
  let rootMore: Comment["more"];

  const walk = (things: any[], into: Comment[], parent?: Comment) => {
    for (const thing of things ?? []) {
      if (thing.kind === "t1") {
        const c = parseComment(thing.data, opAuthor);
        into.push(c);
        const replies = thing.data.replies;
        if (replies && typeof replies === "object") walk(replies.data.children, c.replies, c);
      } else if (thing.kind === "more") {
        const d = thing.data;
        if (d.id === "_" || (d.count === 0 && d.children.length === 0)) {
          if (parent) parent.continue_thread = true;
          continue;
        }
        const more = { count: d.count, children: [...d.children] };
        if (parent) parent.more = mergeMore(parent.more, more);
        else rootMore = mergeMore(rootMore, more);
      }
    }
  };
  walk(children, roots);
  return { roots, rootMore };
}

function mergeMore(a: Comment["more"], b: NonNullable<Comment["more"]>): NonNullable<Comment["more"]> {
  return a ? { count: a.count + b.count, children: [...a.children, ...b.children] } : b;
}

/**
 * Inserts the flat list of things returned by /api/morechildren into the tree.
 * Returns how many comments were added.
 */
export function insertMoreChildren(
  roots: Comment[],
  things: any[],
  opAuthor: string | undefined,
  linkFullname: string,
  onRootMore: (more: NonNullable<Comment["more"]>) => void,
): number {
  const index = new Map<string, Comment>();
  const indexAll = (list: Comment[]) => {
    for (const c of list) {
      index.set(`t1_${c.id}`, c);
      indexAll(c.replies);
    }
  };
  indexAll(roots);

  let added = 0;
  for (const thing of things) {
    const d = thing.data;
    const parent = d.parent_id === linkFullname ? undefined : index.get(d.parent_id);
    if (thing.kind === "t1") {
      if (index.has(`t1_${d.id}`)) continue;
      const c = parseComment(d, opAuthor);
      (parent ? parent.replies : roots).push(c);
      index.set(`t1_${c.id}`, c);
      added++;
    } else if (thing.kind === "more") {
      if (d.id === "_" || (d.count === 0 && d.children.length === 0)) {
        if (parent) parent.continue_thread = true;
        continue;
      }
      const more = { count: d.count, children: [...d.children] };
      if (parent) parent.more = mergeMore(parent.more, more);
      else onRootMore(more);
    }
  }
  return added;
}

export function countComments(list: Comment[]): number {
  return list.reduce((n, c) => n + 1 + countComments(c.replies), 0);
}

/**
 * Removes every pending "more" stub from the tree and returns their ids,
 * stopping after `max` ids. Stubs that did not fit are left in place.
 */
export function takeMoreIds(roots: Comment[], rootMore: Comment["more"] | undefined, max: number) {
  const ids: string[] = [];
  const take = (more: NonNullable<Comment["more"]>): Comment["more"] => {
    const room = max - ids.length;
    if (room <= 0) return more;
    ids.push(...more.children.slice(0, room));
    const rest = more.children.slice(room);
    return rest.length ? { count: Math.max(0, more.count - (more.children.length - rest.length)), children: rest } : undefined;
  };
  // Breadth-first so top-level replies get loaded before deep sub-threads.
  let nextRootMore = rootMore ? take(rootMore) : undefined;
  const queue = [...roots];
  while (queue.length && ids.length < max) {
    const c = queue.shift()!;
    if (c.more) c.more = take(c.more);
    queue.push(...c.replies);
  }
  return { ids, rootMore: nextRootMore };
}

// ---------- rendering ----------

export function renderPost(p: Post, opts: { bodyLimit?: number } = {}): string {
  const lines = [
    `## ${p.title}`,
    `r/${p.subreddit} · u/${p.author} · ${p.score} points${p.upvote_ratio !== undefined ? ` (${Math.round(p.upvote_ratio * 100)}% upvoted)` : ""} · ${p.num_comments} comments · ${p.created}`,
    `id: ${p.id} · ${p.permalink}`,
  ];
  const tags = [p.flair && `flair: ${p.flair}`, p.nsfw && "NSFW", p.spoiler && "spoiler", p.stickied && "pinned", p.locked && "locked"].filter(Boolean);
  if (tags.length) lines.push(tags.join(" · "));
  if (p.url) lines.push(`link: ${p.url}`);
  if (p.crosspost_of) lines.push(`crosspost of: ${p.crosspost_of}`);
  if (p.gallery?.length) lines.push(`gallery: ${p.gallery.join(" ")}`);
  if (p.selftext) lines.push("", truncate(p.selftext, opts.bodyLimit));
  return lines.join("\n");
}

export function renderComments(list: Comment[], opts: { bodyLimit?: number } = {}): string {
  const out: string[] = [];
  const walk = (cs: Comment[], level: number) => {
    const pad = "  ".repeat(level);
    for (const c of cs) {
      const meta = [`u/${c.author}`, c.is_op && "[OP]", c.flair && `[${c.flair}]`, `${c.score} pts`, c.created, c.stickied && "[pinned]", c.edited && "(edited)", `id:${c.id}`]
        .filter(Boolean)
        .join(" · ");
      out.push(`${pad}- ${meta}`, `${pad}  ${indentText(truncate(c.body, opts.bodyLimit), pad + "  ")}`);
      walk(c.replies, level + 1);
      if (c.more) out.push(`${pad}  [${c.more.count} more replies not loaded]`);
      if (c.continue_thread) out.push(`${pad}  [thread continues: use comment_id=${c.id}]`);
    }
  };
  walk(list, 0);
  return out.join("\n");
}

export function renderListingItem(item: Post | Comment, opts: { bodyLimit?: number } = {}): string {
  if ("title" in item) {
    const p = item;
    const head = `- [${p.score}] ${p.title} — r/${p.subreddit} · u/${p.author} · ${p.num_comments} comments · ${p.created}${p.flair ? ` · [${p.flair}]` : ""}${p.nsfw ? " · NSFW" : ""}`;
    const lines = [head, `  id: ${p.id} · ${p.permalink}`];
    if (p.url) lines.push(`  link: ${p.url}`);
    if (p.selftext && opts.bodyLimit !== 0) lines.push(`  ${indentText(truncate(p.selftext, opts.bodyLimit ?? 300), "  ")}`);
    return lines.join("\n");
  }
  const c = item;
  return [
    `- [${c.score}] u/${c.author} in r/${c.subreddit} on "${c.link_title}" · ${c.created}`,
    `  ${c.permalink}`,
    `  ${indentText(truncate(c.body, opts.bodyLimit ?? 500), "  ")}`,
  ].join("\n");
}


// ---------- input parsing ----------

/**
 * Accepts a post id, fullname (t3_xxx), or any reddit.com / redd.it URL,
 * including comment permalinks. Returns the post id and an optional comment id.
 */
export function parsePostRef(input: string): { postId: string; commentId?: string; shareUrl?: string } {
  const s = input.trim();
  if (/^(t3_)?[a-z0-9]{4,10}$/i.test(s)) return { postId: s.replace(/^t3_/i, "") };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    throw new Error(`Not a Reddit post id or URL: ${input}`);
  }
  const host = url.hostname.replace(/^www\.|^old\.|^new\.|^np\.|^m\./, "");
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "redd.it" && parts[0]) return { postId: parts[0] };
  if (!host.endsWith("reddit.com")) throw new Error(`Not a Reddit URL: ${input}`);

  const ci = parts.indexOf("comments");
  if (ci !== -1 && parts[ci + 1]) {
    return { postId: parts[ci + 1], commentId: parts[ci + 3] };
  }
  // Mobile share links (/r/sub/s/AbCdEf) redirect to the real permalink.
  if (parts[2] === "s" && parts[3]) return { postId: "", shareUrl: url.toString() };
  throw new Error(`Could not find a post id in: ${input}`);
}

export function cleanSubreddit(name: string): string {
  return name.trim().replace(/^(https?:\/\/)?(www\.)?reddit\.com/i, "").replace(/^\/?r\//i, "").replace(/\/.*$/, "");
}

export function cleanUsername(name: string): string {
  return name.trim().replace(/^(https?:\/\/)?(www\.)?reddit\.com/i, "").replace(/^\/?(u|user)\//i, "").replace(/\/.*$/, "");
}
