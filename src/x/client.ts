// Client for the official X API v2 (app-only bearer token), with caching,
// rate-limit handling and a daily cap on billed post reads.

import { sleep } from "../common.js";

export interface XClientOptions {
  bearerToken: string;
  /** Maximum posts read per UTC day; X bills pay-per-use accounts per post read. 0 disables the cap. */
  dailyPostLimit?: number;
  cacheTtlMs?: number;
  maxRetries?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class XError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

type Params = Record<string, string | number | boolean | undefined>;

export class XClient {
  private readonly opts: Required<XClientOptions>;
  private readonly cache = new Map<string, { expires: number; data: unknown }>();
  private usage = { day: "", posts: 0 };

  constructor(options: XClientOptions) {
    this.opts = {
      dailyPostLimit: 1000,
      cacheTtlMs: 60_000,
      maxRetries: 3,
      baseUrl: "https://api.x.com/2",
      fetchImpl: globalThis.fetch.bind(globalThis),
      ...definedOnly(options),
    };
  }

  /** Posts read today (UTC) by this process, and the configured cap. */
  get postsReadToday(): { used: number; limit: number } {
    this.rollDay();
    return { used: this.usage.posts, limit: this.opts.dailyPostLimit };
  }

  async get<T = any>(path: string, params: Params = {}): Promise<T> {
    const url = new URL(this.opts.baseUrl.replace(/\/$/, "") + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    const key = url.toString();
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.data as T;

    this.rollDay();
    const { dailyPostLimit } = this.opts;
    if (dailyPostLimit > 0 && this.usage.posts >= dailyPostLimit) {
      throw new XError(
        `Daily cap of ${dailyPostLimit} post reads reached (X bills per post read). Raise X_DAILY_POST_LIMIT or wait until 00:00 UTC.`,
      );
    }

    const data = await this.request<any>(key);
    this.usage.posts += countPosts(data);
    if (this.opts.cacheTtlMs > 0) {
      this.cache.set(key, { expires: Date.now() + this.opts.cacheTtlMs, data });
      if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
    }
    return data as T;
  }

  private async request<T>(url: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.opts.fetchImpl(url, {
          headers: { Authorization: `Bearer ${this.opts.bearerToken}`, "User-Agent": "x-mcp/0.1" },
        });
      } catch (err) {
        if (attempt >= this.opts.maxRetries) throw new XError(`Network error: ${(err as Error).message}`);
        await sleep(1000 * 2 ** attempt);
        continue;
      }

      const body: any = await res.json().catch(() => ({}));
      if (res.ok) {
        // X answers 200 with only `errors` when every requested item is missing.
        if (!body.data && body.errors?.length) throw new XError(describeErrors(body.errors), 404);
        return body as T;
      }

      if ((res.status === 429 || res.status >= 500) && attempt < this.opts.maxRetries) {
        const reset = Number(res.headers.get("x-rate-limit-reset")) * 1000;
        const wait = res.status === 429 && reset > Date.now() ? reset - Date.now() : 1000 * 2 ** attempt;
        // Don't hang a tool call for most of a 15-minute window.
        if (wait > 120_000) {
          throw new XError(`X rate limit reached for this endpoint; it resets at ${new Date(reset).toISOString()}.`, 429);
        }
        await sleep(wait + 250);
        continue;
      }
      throw new XError(describeFailure(res.status, body), res.status);
    }
  }

  private rollDay(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (this.usage.day !== today) this.usage = { day: today, posts: 0 };
  }
}

function countPosts(body: any): number {
  const data = Array.isArray(body?.data) ? body.data.length : body?.data?.text !== undefined ? 1 : 0;
  return data + (body?.includes?.tweets?.length ?? 0);
}

function describeErrors(errors: any[]): string {
  return errors.map((e) => e.detail ?? e.message ?? e.title).join("; ");
}

function describeFailure(status: number, body: any): string {
  const detail = body?.detail ?? body?.title ?? (body?.errors ? describeErrors(body.errors) : "");
  switch (status) {
    case 401:
      return `X rejected the bearer token (401). Check X_BEARER_TOKEN. ${detail}`.trim();
    case 402:
      return `X refused the request for billing reasons (402): ${detail || "add credits in the X developer console"}.`;
    case 403:
      return `X refused access (403): ${detail || "your app's access level does not include this endpoint"}.`;
    case 429:
      return `X kept rate-limiting after retries (429). ${detail}`.trim();
    default:
      return `X API returned HTTP ${status}${detail ? `: ${detail}` : ""}.`;
  }
}

/** Drops undefined values so they don't override defaults when spread. */
function definedOnly<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}
