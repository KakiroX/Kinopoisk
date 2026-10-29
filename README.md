# social-mcp

An MCP server that gives Claude read access to **Reddit** and **X (Twitter)**: whole threads with every reply, listings, search, and user history. It runs on your machine or your own server, so there is no hosted quota in front of it. The only limits are the ones Reddit and X set for your API keys.

## Tools

### Reddit (always on)

| Tool | What it does |
| --- | --- |
| `reddit_get_thread` | Post plus the full comment tree. Takes any post URL, comment permalink, `redd.it` or `/s/` share link, or id. It expands "load more comments" branches automatically and can focus on one comment's sub-thread. |
| `reddit_get_posts` | Metadata for up to 1000 posts in one call. |
| `reddit_get_subreddit_posts` | hot / new / top / rising / controversial, paging automatically up to 1000. |
| `reddit_get_subreddit_comments` | Newest comments across a subreddit. |
| `reddit_search` | Post search, site-wide or in one subreddit, with Reddit operators (`title:`, `author:`, `site:`, `flair:` ...). |
| `reddit_search_subreddits` | Find communities on a topic. |
| `reddit_get_subreddit_info` | Description, member and online counts, rules. |
| `reddit_get_user` | Karma, account age, recent activity. |
| `reddit_get_user_content` | Page through a user's posts and/or comments. |

### X (when `X_BEARER_TOKEN` is set)

| Tool | What it does |
| --- | --- |
| `x_get_post` | One post with the full text of long posts, plus quoted/reposted post, media and links. |
| `x_get_posts` | Up to 500 posts by URL or id. |
| `x_get_thread` | A whole conversation as a reply tree (the original post, the author's own thread replies first, then everyone else). Give it the link to any post in the conversation. |
| `x_search` | Search with X operators: `from:`, `to:`, `#tag`, `"phrase"`, `-is:retweet`, `has:media`, `lang:`, `url:` ... |
| `x_get_user` | Bio, follower counts, join date, recent posts. |
| `x_get_user_posts` | A user's timeline (up to their latest 3200 posts). |
| `x_get_quotes` | Posts quoting a given post. |

Every tool returns compact text by default, or structured data with `format: "json"`. Listings return a cursor for continuing.

## Build

```bash
npm install
npm run build
```

## Try it in Claude

### Claude Desktop (simplest)

Open **Settings → Developer → Edit Config** and add:

```json
{
  "mcpServers": {
    "social": {
      "command": "node",
      "args": ["/absolute/path/to/social-mcp/dist/src/index.js"],
      "env": {
        "X_BEARER_TOKEN": "..."
      }
    }
  }
}
```

Every key is optional. Without `X_BEARER_TOKEN` you get the Reddit tools only, and Reddit works without keys (see [Limits and costs](#limits-and-costs)).

Restart Claude Desktop. The tools appear under the tools/connectors menu in a chat. Then try: *"Summarise the top arguments in https://www.reddit.com/r/... thread"*.

### Claude Code

```bash
claude mcp add social -e X_BEARER_TOKEN=... -- node /absolute/path/to/dist/src/index.js
```

### claude.ai (web and mobile) as a custom connector

claude.ai connects to remote servers over HTTPS, so run the server in HTTP mode and give it a public URL.

1. Pick a long random secret. It goes in the URL, so anyone without it gets `401`:

   ```bash
   export MCP_AUTH_TOKEN=$(openssl rand -hex 24)
   ```

2. Start the server:

   ```bash
   X_BEARER_TOKEN=... npm run start:http
   ```

3. Expose it. For a quick test from your own machine, a Cloudflare quick tunnel needs no account:

   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```

   It prints a `https://<random>.trycloudflare.com` address. For something permanent, deploy the included `Dockerfile` to any container host (Fly.io, Render, Railway, a VPS) with the same environment variables.

4. In claude.ai, open **Settings → Connectors → Add custom connector**. Enter this URL and leave the OAuth fields empty:

   ```
   https://<your-host>/mcp/<MCP_AUTH_TOKEN>
   ```

Treat that URL like a password: it spends your X credits. Clients that can send headers can use `https://<your-host>/mcp` with `Authorization: Bearer <MCP_AUTH_TOKEN>` instead, for example:

```bash
claude mcp add --transport http social https://host/mcp --header "Authorization: Bearer ..."
```

### Poke at it without Claude

```bash
npx @modelcontextprotocol/inspector node dist/src/index.js
```

## Run on a Raspberry Pi

A Pi makes a good always-on host for the claude.ai connector. The server is plain JavaScript with no native modules, so it runs on any Pi that can run Node 18 or newer, and it idles at about 85 MB of memory.

| Model | Works? |
| --- | --- |
| Pi 5, 4, 3, Zero 2 W | Yes. A 64-bit OS is best; 32-bit works too. |
| Pi 1 or original Zero (ARMv6) | Only with an unofficial Node build. Not recommended. |

Reddit is also less likely to block requests from a home connection than from a cloud server. That matters if you run without Reddit keys.

**1. Install Node 22 and build:**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
```

```bash
sudo apt-get install -y nodejs git
```

```bash
git clone https://github.com/KakiroX/Kinopoisk.git social-mcp
```

```bash
cd social-mcp && npm ci && npm run build
```

**2. Configure:**

```bash
cp .env.example .env && nano .env
```

The only line you need is `MCP_AUTH_TOKEN` (make one with `openssl rand -hex 24`). Add `X_BEARER_TOKEN` if you want the X tools. Leave the rest empty unless you have them.

**3. Run it as a service** so it starts on boot and restarts after crashes. This installs `deploy/social-mcp.service` with your user and checkout path filled in:

```bash
sed "s#/home/pi/social-mcp#$PWD#g; s#^User=pi#User=$(id -un)#" deploy/social-mcp.service | sudo tee /etc/systemd/system/social-mcp.service
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now social-mcp
```

Check it:

```bash
curl localhost:3000/healthz
```

To see the logs:

```bash
journalctl -u social-mcp -f
```

**4. Give it a public HTTPS address.** Both options leave your router closed:

- **Tailscale Funnel (recommended):** free, and the address stays the same. [Install Tailscale](https://tailscale.com/download/linux) on the Pi, run `sudo tailscale up`, then run `sudo tailscale funnel --bg 3000`. Your connector URL is `https://<pi-name>.<tailnet>.ts.net/mcp/<MCP_AUTH_TOKEN>`.
- **Cloudflare quick tunnel:** `cloudflared tunnel --url http://localhost:3000` (ARM builds are on [Cloudflare's downloads page](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)). The address changes every time it restarts, so it suits testing. A permanent Cloudflare address needs a domain on Cloudflare.

Then add the URL in claude.ai under **Settings → Connectors → Add custom connector**, as described above.

**Updating:**

```bash
git pull && npm ci && npm run build && sudo systemctl restart social-mcp
```

Docker also works on a Pi: the `node:22-alpine` base image has ARM versions. The setup above is lighter, though.

## Limits and costs

**Reddit.** Reddit enforces limits per client:

| Mode | How | Limit |
| --- | --- | --- |
| No keys (default) | no env vars | Free. About 10 requests/min per IP; the server waits and retries when it hits the limit. Reddit often blocks this from cloud servers, rarely from home connections. |
| OAuth app | `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` | 100 requests/min |

Reddit keys are optional. OAuth is free for personal, non-commercial use, but under Reddit's Responsible Builder Policy a new app needs Reddit's approval before it can read data, reportedly after a wait of weeks. If you already have an approved app, create a "script" app at <https://www.reddit.com/prefs/apps> and set the keys. Otherwise run without them. Commercial use needs a separate paid agreement with Reddit.

**X.** X's API has been pay-per-use since February 2026, and there is no free read tier for new developers. Third-party guides put reads at about **$0.005 per post**; check the current rates in the X developer console. Get a bearer token at <https://console.x.com>. Every post the server reads counts toward your bill, including quoted posts it pulls in for context. To keep that under control:

- `X_DAILY_POST_LIMIT` (default **1000** posts/day, about $5) stops the server from reading more until 00:00 UTC. Set `0` to remove the cap.
- Every X tool result ends with `[X post reads today: N/limit]`, so you see the spend as you go.
- Tool limits default low (20 posts for search, 100 replies for threads).
- `x_get_thread` and `x_search` cover the last 7 days unless you pass `archive: true`, which needs full-archive access on your X plan.

**For both,** the server stays inside the limits without you managing them:

- It reads the rate-limit headers and waits for the window to reset instead of failing.
- It retries 429 and 5xx responses with backoff.
- It caches responses for 60 s, so repeat questions cost nothing.
- It always fetches the maximum page size the API allows.

## Environment variables

See `.env.example`.

| Variable | Purpose |
| --- | --- |
| `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` | Reddit OAuth app (recommended) |
| `REDDIT_USERNAME`, `REDDIT_PASSWORD` | Optional: authenticate as your Reddit account |
| `REDDIT_USER_AGENT` | Reddit asks for `platform:app-id:version (by /u/yourname)` |
| `X_BEARER_TOKEN` | Enables the X tools |
| `X_DAILY_POST_LIMIT` | Daily cap on billed X post reads (default 1000, `0` = none) |
| `MCP_TRANSPORT=http` or `--http` | Serve Streamable HTTP instead of stdio |
| `PORT`, `HOST` | HTTP listen address (default `0.0.0.0:3000`) |
| `MCP_AUTH_TOKEN` | Secret for HTTP mode (strongly recommended) |
| `CACHE_TTL` | Cache lifetime in seconds (default 60, `0` disables) |
| `REDDIT_PUBLIC_BASE`, `REDDIT_OAUTH_BASE`, `REDDIT_TOKEN_URL`, `X_API_BASE` | Override API hosts (used by the tests) |

## Development

```bash
npm test
```

The tests run the real server against local fake Reddit and X APIs that return the real response shapes. They cover stdio and HTTP transports, thread and reply-tree building, "more comments" expansion, pagination, 429 handling, OAuth, the X spending cap, and URL parsing.
