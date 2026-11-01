// Minimal copies of Reddit API response shapes, used by the fake server.

const t1 = (id: string, parent: string, body: string, depth: number, replies: any[] = [], extra: any = {}) => ({
  kind: "t1",
  data: {
    id,
    name: `t1_${id}`,
    parent_id: parent,
    author: extra.author ?? `user_${id}`,
    body,
    score: extra.score ?? 10,
    created_utc: 1761700000,
    depth,
    is_submitter: extra.is_submitter ?? false,
    replies: replies.length ? { kind: "Listing", data: { children: replies } } : "",
    permalink: `/r/test/comments/abc123/title/${id}/`,
    ...extra,
  },
});

const more = (id: string, parent: string, children: string[], count = children.length, depth = 0) => ({
  kind: "more",
  data: { id, name: `t1_${id}`, parent_id: parent, children, count, depth },
});

export const post = {
  id: "abc123",
  name: "t3_abc123",
  subreddit: "test",
  title: "Test thread title",
  author: "op_user",
  score: 1234,
  upvote_ratio: 0.97,
  num_comments: 9,
  created_utc: 1761690000,
  permalink: "/r/test/comments/abc123/test_thread_title/",
  url: "https://www.reddit.com/r/test/comments/abc123/test_thread_title/",
  is_self: true,
  selftext: "Body of the post",
  link_flair_text: "Discussion",
};

export const thread = [
  { kind: "Listing", data: { children: [{ kind: "t3", data: post }] } },
  {
    kind: "Listing",
    data: {
      children: [
        t1("c1", "t3_abc123", "Top comment", 0, [
          t1("c2", "t1_c1", "Reply from OP", 1, [], { author: "op_user", is_submitter: true }),
          more("m1", "t1_c1", ["c3"], 1, 1),
        ]),
        t1("c4", "t3_abc123", "Second top comment", 0, [more("_", "t1_c4", [], 0, 1)]),
        more("m2", "t3_abc123", ["c5", "c6"], 4),
      ],
    },
  },
];

export const moreChildren = {
  json: {
    errors: [],
    data: {
      things: [
        t1("c3", "t1_c1", "Expanded nested reply", 1),
        t1("c5", "t3_abc123", "Expanded top-level comment", 0),
        t1("c7", "t1_c5", "Reply to expanded comment", 1),
        t1("c6", "t3_abc123", "Another expanded top-level", 0),
      ],
    },
  },
};

export function listingPage(prefix: string, start: number, count: number, after: string | null) {
  return {
    kind: "Listing",
    data: {
      after,
      children: Array.from({ length: count }, (_, i) => ({
        kind: "t3",
        data: { ...post, id: `${prefix}${start + i}`, title: `Post ${start + i}`, permalink: `/r/test/comments/${prefix}${start + i}/x/` },
      })),
    },
  };
}

export const subredditAbout = {
  kind: "t5",
  data: {
    display_name: "test",
    title: "Testing subreddit",
    public_description: "A place for tests",
    subscribers: 123456,
    active_user_count: 42,
    created_utc: 1200000000,
    over18: false,
    url: "/r/test/",
  },
};

export const subredditRules = {
  rules: [
    { short_name: "Be nice", description: "No insults." },
    { short_name: "No spam", description: "" },
  ],
};

export const userAbout = {
  kind: "t2",
  data: { name: "op_user", created_utc: 1300000000, link_karma: 500, comment_karma: 1500, total_karma: 2000, verified: true },
};

export const userOverview = {
  kind: "Listing",
  data: {
    after: null,
    children: [
      { kind: "t3", data: { ...post, id: "u1", title: "User post" } },
      t1("u2", "t3_abc123", "User comment", 0, [], { link_title: "Some thread", subreddit: "test" }),
    ],
  },
};
