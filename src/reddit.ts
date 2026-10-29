// Thin Reddit API client: OAuth (when credentials are given) or the public
// .json endpoints, with response caching, header-driven pacing and retries.

export interface RedditClientOptions {
  userAgent: string;
  clientId?: string;
  clientSecret?: string;
  username?: string;
  password?: string;
  cacheTtlMs?: number;
  maxRetries?: number;
  publicBase?: string;
  oauthBase?: string;
  tokenUrl?: string;
  fetchImpl?: typeof fetch;
}

export class RedditError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

type Params = Record<string, string | number | boolean | undefined>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class RedditClient {
  private readonly opts: Required<Omit<RedditClientOptions, "clientId" | "clientSecret" | "username" | "password">> &
    RedditClientOptions;
  private token?: { value: string; expiresAt: number };
  private tokenPromise?: Promise<string>;
  private readonly cache = new Map<string, { expires: number; data: unknown }>();
  // Budget reported by Reddit in x-ratelimit-* headers for the current window.
  private remaining = Number.POSITIVE_INFINITY;
  private resetAt = 0;

  constructor(options: RedditClientOptions) {
    this.opts = {
      cacheTtlMs: 60_000,
      maxRetries: 5,
      publicBase: "https://www.reddit.com",
      oauthBase: "https://oauth.reddit.com",
      tokenUrl: "https://www.reddit.com/api/v1/access_token",
      fetchImpl: globalThis.fetch.bind(globalThis),
      ...options,
    };
  }

  get authenticated(): boolean {
    return Boolean(this.opts.clientId);
  }

  async get<T = any>(path: string, params: Params = {}): Promise<T> {
    const url = this.buildUrl(path, params);
    const cached = this.cache.get(url);
    if (cached && cached.expires > Date.now()) return cached.data as T;

    const data = await this.request<T>(url);
    if (this.opts.cacheTtlMs > 0) {
      this.cache.set(url, { expires: Date.now() + this.opts.cacheTtlMs, data });
      if (this.cache.size > 500) this.pruneCache();
    }
    return data;
  }

  private buildUrl(path: string, params: Params): string {
    const base = this.authenticated ? this.opts.oauthBase : this.opts.publicBase;
    // The public site only returns JSON when the path ends in .json.
    const fullPath = this.authenticated || path.endsWith(".json") ? path : `${path.replace(/\/$/, "")}.json`;
    const url = new URL(fullPath, base);
    url.searchParams.set("raw_json", "1");
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  private async request<T>(url: string): Promise<T> {
    let refreshedToken = false;
    for (let attempt = 0; ; attempt++) {
      await this.waitForBudget();

      const headers: Record<string, string> = { "User-Agent": this.opts.userAgent, Accept: "application/json" };
      if (this.authenticated) headers.Authorization = `Bearer ${await this.getToken()}`;

      let res: Response;
      try {
        res = await this.opts.fetchImpl(url, { headers, redirect: "follow" });
      } catch (err) {
        if (attempt >= this.opts.maxRetries) throw new RedditError(`Network error: ${(err as Error).message}`);
        await sleep(this.backoff(attempt));
        continue;
      }
      this.recordRateLimit(res.headers);

      if (res.ok) {
        const text = await res.text();
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new RedditError(`Reddit returned non-JSON content (${text.slice(0, 120).trim()}...)`, res.status);
        }
      }

      if (res.status === 401 && this.authenticated && !refreshedToken) {
        this.token = undefined;
        refreshedToken = true;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < this.opts.maxRetries) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : this.backoff(attempt);
        await sleep(Math.max(wait, this.resetAt - Date.now()));
        continue;
      }
      throw new RedditError(describeStatus(res.status, url), res.status);
    }
  }

  private backoff(attempt: number): number {
    return Math.min(30_000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 250);
  }

  private recordRateLimit(headers: Headers): void {
    const remaining = Number(headers.get("x-ratelimit-remaining"));
    const reset = Number(headers.get("x-ratelimit-reset"));
    if (headers.has("x-ratelimit-remaining") && Number.isFinite(remaining)) this.remaining = remaining;
    if (headers.has("x-ratelimit-reset") && Number.isFinite(reset)) this.resetAt = Date.now() + reset * 1000;
  }

  // When the window's budget is spent, wait for it to reset instead of
  // collecting 429s.
  private async waitForBudget(): Promise<void> {
    if (this.remaining >= 1) {
      this.remaining -= 1;
      return;
    }
    const wait = this.resetAt - Date.now();
    if (wait > 0) await sleep(wait + 100);
    this.remaining = Number.POSITIVE_INFINITY;
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    this.tokenPromise ??= this.fetchToken().finally(() => (this.tokenPromise = undefined));
    return this.tokenPromise;
  }

  private async fetchToken(): Promise<string> {
    const { clientId, clientSecret = "", username, password } = this.opts;
    const body = new URLSearchParams(
      username && password ? { grant_type: "password", username, password } : { grant_type: "client_credentials" },
    );
    const res = await this.opts.fetchImpl(this.opts.tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "User-Agent": this.opts.userAgent,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !json.access_token) {
      throw new RedditError(`Reddit OAuth failed (${res.status} ${json.error ?? ""}). Check REDDIT_CLIENT_ID/SECRET.`, res.status);
    }
    this.token = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }

  private pruneCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) if (entry.expires <= now) this.cache.delete(key);
    while (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
  }
}

function describeStatus(status: number, url: string): string {
  const path = new URL(url).pathname;
  switch (status) {
    case 403:
      return `403 Forbidden for ${path}: the subreddit or user is private, quarantined, or Reddit blocked the request.`;
    case 404:
      return `404 Not Found for ${path}: the subreddit, post or user does not exist or was banned.`;
    case 429:
      return `Reddit kept rate-limiting ${path} after retries. Set REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET for a higher limit.`;
    default:
      return `Reddit returned HTTP ${status} for ${path}.`;
  }
}
