// Turns X API v2 responses (data + includes) into compact posts and renders them.

import { indentText, truncate } from "../common.js";

export interface XUser {
  id: string;
  username: string;
  name: string;
  description?: string;
  created?: string;
  followers?: number;
  following?: number;
  posts?: number;
  verified?: boolean;
  verified_type?: string;
  location?: string;
  url?: string;
}

export interface XPost {
  id: string;
  url: string;
  author: string;
  author_name?: string;
  text: string;
  created: string;
  likes?: number;
  replies?: number;
  reposts?: number;
  quotes?: number;
  views?: number;
  conversation_id?: string;
  in_reply_to?: string;
  quoted?: XPost;
  reposted?: XPost;
  media?: { type: string; url?: string; alt?: string }[];
  links?: string[];
  sensitive?: boolean;
  lang?: string;
}

export interface Includes {
  users?: any[];
  tweets?: any[];
  media?: any[];
}

export const TWEET_PARAMS = {
  "tweet.fields":
    "created_at,author_id,conversation_id,public_metrics,referenced_tweets,in_reply_to_user_id,lang,note_tweet,entities,attachments,possibly_sensitive",
  expansions: "author_id,referenced_tweets.id,referenced_tweets.id.author_id,attachments.media_keys",
  "user.fields": "username,name,verified,verified_type",
  "media.fields": "type,url,preview_image_url,alt_text",
};

export const USER_FIELDS = "created_at,description,location,url,public_metrics,verified,verified_type";

export function parseUser(u: any): XUser {
  const m = u.public_metrics ?? {};
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    description: u.description || undefined,
    created: u.created_at,
    followers: m.followers_count,
    following: m.following_count,
    posts: m.tweet_count,
    verified: u.verified || undefined,
    verified_type: u.verified_type && u.verified_type !== "none" ? u.verified_type : undefined,
    location: u.location || undefined,
    url: u.entities?.url?.urls?.[0]?.expanded_url ?? (u.url || undefined),
  };
}

export function parsePost(t: any, inc: Includes = {}, nest = true): XPost {
  const users = new Map((inc.users ?? []).map((u) => [u.id, u]));
  const tweets = new Map((inc.tweets ?? []).map((x) => [x.id, x]));
  const media = new Map((inc.media ?? []).map((m) => [m.media_key, m]));
  const author = users.get(t.author_id);
  const m = t.public_metrics ?? {};
  const username = author?.username ?? "i";

  const post: XPost = {
    id: t.id,
    url: `https://x.com/${username}/status/${t.id}`,
    author: author?.username ?? t.author_id ?? "unknown",
    author_name: author?.name,
    text: t.note_tweet?.text ?? t.text ?? "",
    created: t.created_at ?? "",
    likes: m.like_count,
    replies: m.reply_count,
    reposts: m.retweet_count,
    quotes: m.quote_count,
    views: m.impression_count,
    conversation_id: t.conversation_id,
  };

  for (const ref of t.referenced_tweets ?? []) {
    if (ref.type === "replied_to") post.in_reply_to = ref.id;
    const target = tweets.get(ref.id);
    if (!nest || !target) continue;
    if (ref.type === "quoted") post.quoted = parsePost(target, inc, false);
    // Reposts carry truncated text; the original has the full post.
    if (ref.type === "retweeted") post.reposted = parsePost(target, inc, false);
  }

  const keys: string[] = t.attachments?.media_keys ?? [];
  if (keys.length) {
    post.media = keys.map((k) => {
      const md = media.get(k);
      return { type: md?.type ?? "unknown", url: md?.url ?? md?.preview_image_url, alt: md?.alt_text || undefined };
    });
  }
  const links = (t.note_tweet?.entities?.urls ?? t.entities?.urls ?? [])
    .map((u: any) => u.unwound_url ?? u.expanded_url)
    .filter((u: string | undefined) => u && !/^https:\/\/(x|twitter)\.com\/[^/]+\/status\/\d+\/(photo|video)\//.test(u));
  if (links.length) post.links = links;
  if (t.possibly_sensitive) post.sensitive = true;
  if (t.lang && t.lang !== "und") post.lang = t.lang;
  return post;
}

export function parsePosts(body: any): XPost[] {
  const data = Array.isArray(body?.data) ? body.data : body?.data ? [body.data] : [];
  return data.map((t: any) => parsePost(t, body.includes));
}

export interface ThreadNode extends XPost {
  children: ThreadNode[];
}

/**
 * Arranges a conversation's posts into a reply tree under the root post.
 * Replies whose parent was not fetched are attached to the root and keep
 * their `in_reply_to` id.
 */
export function buildThread(root: XPost, replies: XPost[]): { tree: ThreadNode; orphans: number } {
  const nodes = new Map<string, ThreadNode>();
  const rootNode: ThreadNode = { ...root, children: [] };
  nodes.set(root.id, rootNode);
  for (const r of replies) if (!nodes.has(r.id)) nodes.set(r.id, { ...r, children: [] });

  let orphans = 0;
  for (const node of nodes.values()) {
    if (node === rootNode) continue;
    const parent = node.in_reply_to ? nodes.get(node.in_reply_to) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else {
      rootNode.children.push(node);
      orphans++;
    }
  }
  const sort = (n: ThreadNode) => {
    // The author's own replies (thread continuations) first, then by time.
    n.children.sort((a, b) => Number(b.author === root.author) - Number(a.author === root.author) || a.created.localeCompare(b.created));
    n.children.forEach(sort);
  };
  sort(rootNode);
  return { tree: rootNode, orphans };
}

// ---------- rendering ----------

const stats = (p: XPost) =>
  [
    p.likes !== undefined && `${p.likes} likes`,
    p.reposts && `${p.reposts} reposts`,
    p.replies && `${p.replies} replies`,
    p.quotes && `${p.quotes} quotes`,
    p.views && `${p.views} views`,
  ]
    .filter(Boolean)
    .join(" · ");

export function renderPost(p: XPost, opts: { bodyLimit?: number; pad?: string } = {}): string {
  const pad = opts.pad ?? "";
  if (p.reposted) {
    return `${pad}- @${p.author} reposted · ${p.created}\n${renderPost(p.reposted, { ...opts, pad: pad + "  " })}`;
  }
  const lines = [
    `${pad}- @${p.author}${p.author_name ? ` (${p.author_name})` : ""} · ${p.created}${stats(p) ? ` · ${stats(p)}` : ""}`,
    `${pad}  ${p.url}`,
    `${pad}  ${indentText(truncate(p.text, opts.bodyLimit), pad + "  ")}`,
  ];
  if (p.media?.length) lines.push(`${pad}  media: ${p.media.map((m) => `${m.type}${m.url ? ` ${m.url}` : ""}${m.alt ? ` (alt: ${m.alt})` : ""}`).join(", ")}`);
  if (p.links?.length) lines.push(`${pad}  links: ${p.links.join(" ")}`);
  if (p.sensitive) lines.push(`${pad}  [marked sensitive]`);
  if (p.quoted) lines.push(`${pad}  quoting:`, renderPost(p.quoted, { ...opts, pad: pad + "    " }));
  return lines.join("\n");
}

export function renderThread(node: ThreadNode, opts: { bodyLimit?: number } = {}, level = 0): string {
  const out = [renderPost(node, { ...opts, pad: "  ".repeat(level) })];
  for (const child of node.children) out.push(renderThread(child, opts, level + 1));
  return out.join("\n");
}

export function renderUser(u: XUser): string {
  const lines = [
    `## @${u.username} (${u.name})${u.verified_type ? ` · verified (${u.verified_type})` : u.verified ? " · verified" : ""}`,
    [
      u.followers !== undefined && `${u.followers.toLocaleString("en-US")} followers`,
      u.following !== undefined && `${u.following.toLocaleString("en-US")} following`,
      u.posts !== undefined && `${u.posts.toLocaleString("en-US")} posts`,
      u.created && `joined ${u.created.slice(0, 10)}`,
    ]
      .filter(Boolean)
      .join(" · "),
    `https://x.com/${u.username} · id ${u.id}`,
  ];
  if (u.location) lines.push(`location: ${u.location}`);
  if (u.url) lines.push(`website: ${u.url}`);
  if (u.description) lines.push("", u.description);
  return lines.join("\n");
}

// ---------- input parsing ----------

/** Accepts a numeric post id or any x.com / twitter.com (and fx/vx mirror) status URL. */
export function parsePostId(input: string): string {
  const s = input.trim();
  if (/^\d{1,25}$/.test(s)) return s;
  const m = s.match(/(?:^|\/\/|\.)(?:x|twitter|fxtwitter|vxtwitter|fixupx|fixvx)\.com\/(?:[^/]+|i(?:\/web)?)\/status(?:es)?\/(\d+)/i);
  if (m) return m[1];
  throw new Error(`Not an X post id or URL: ${input}`);
}

export function cleanUsername(input: string): string {
  const s = input.trim();
  const m = s.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})/i);
  return (m ? m[1] : s).replace(/^@/, "");
}
