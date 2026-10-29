# reddit-mcp

An MCP server that lets Claude read Reddit: full threads with every comment expanded, subreddit listings, search, and user history. It runs locally over stdio, so there is no hosted quota in front of it. The only limit is the one Reddit sets for your client.

## Tools

| Tool | What it does |
| --- | --- |
| `reddit_get_thread` | Post plus the full comment tree. Takes any post URL, comment permalink, `redd.it` or `/s/` share link, or bare id. It expands "load more comments" branches automatically and can focus on one comment's sub-thread. |
| `reddit_get_posts` | Metadata for up to 1000 posts in one call (100 per request). |
| `reddit_get_subreddit_posts` | hot / new / top / rising / controversial, with time windows. It pages through results automatically up to 1000 posts. |
| `reddit_get_subreddit_comments` | Newest comments across a whole subreddit. |
| `reddit_search` | Post search, site-wide or within one subreddit, with Reddit's search operators (`title:`, `author:`, `site:`, `flair:`, ...). |
| `reddit_search_subreddits` | Find communities on a topic. |
| `reddit_get_subreddit_info` | Description, member and online counts, rules. |
| `reddit_get_user` | Karma, account age, recent activity. |
| `reddit_get_user_content` | Page through a user's posts and/or comments. |

Every tool returns compact text by default, or structured data with `format: "json"`. Listings return an `after` cursor for continuing.

## Setup

```bash
npm install
npm run build
```

### Claude Code

```bash
claude mcp add reddit -e REDDIT_CLIENT_ID=xxx -e REDDIT_CLIENT_SECRET=yyy -- node /absolute/path/to/dist/src/index.js
```

### Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "reddit": {
      "command": "node",
      "args": ["/absolute/path/to/dist/src/index.js"],
      "env": {
        "REDDIT_CLIENT_ID": "xxx",
        "REDDIT_CLIENT_SECRET": "yyy"
      }
    }
  }
}
```

## Rate limits

Reddit enforces its own limits per client:

| Mode | How | Limit |
| --- | --- | --- |
| Unauthenticated | no env vars | about 10 requests/min per IP, and Reddit sometimes blocks it outright |
| OAuth app | `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` | 100 requests/min |

**Use OAuth.** Create a "script" app at <https://www.reddit.com/prefs/apps>. The id is the string under the app name and the secret is labelled "secret". You can also set `REDDIT_USERNAME` and `REDDIT_PASSWORD` to act as your account (password grant), which lets the server read things your account can see.

The server stays inside the limit without you managing it:

- It reads Reddit's `x-ratelimit-remaining` / `x-ratelimit-reset` headers. When the budget runs out, it waits for the window to reset instead of failing.
- It retries 429 and 5xx responses with backoff and honours `Retry-After`.
- It caches responses for 60 s (`REDDIT_CACHE_TTL`, in seconds; `0` disables), so repeated questions about the same thread don't use requests.
- It fetches up to 100 items per request, the maximum Reddit allows, both for listings and for comment expansion.

A 500-comment thread usually costs 2–6 requests.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | OAuth app credentials (recommended) |
| `REDDIT_USERNAME`, `REDDIT_PASSWORD` | Optional: authenticate as a user |
| `REDDIT_USER_AGENT` | Reddit asks for `platform:app-id:version (by /u/yourname)` |
| `REDDIT_CACHE_TTL` | Cache lifetime in seconds (default 60) |
| `REDDIT_PUBLIC_BASE`, `REDDIT_OAUTH_BASE`, `REDDIT_TOKEN_URL` | Override API hosts (used by the tests) |

## Development

```bash
npm test
```

The tests start a local HTTP server that returns Reddit-shaped responses. They then run the real MCP server against it over stdio and check thread-tree building, "more comments" expansion, pagination, 429 retries, OAuth and URL parsing.
