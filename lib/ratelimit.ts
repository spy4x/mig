// In-process rate limiter for booking submissions.
//
// Sliding window per IP. Resets on restart (acceptable: an attacker
// would just have to wait 5 min). For real abuse, front mig with
// Cloudflare or Traefik's IP-based rate-limit middleware.

export interface RateLimiterOptions {
  windowMs: number; // window length, e.g. 5 * 60_000
  max: number; // max events in window per key
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

interface Bucket {
  // Timestamps (ms) of events in the current window, oldest first.
  events: number[];
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private windowMs: number;
  private max: number;
  // Prune stale buckets periodically to bound memory.
  private lastPrune = Date.now();
  private readonly pruneIntervalMs = 10 * 60_000;

  constructor(opts: RateLimiterOptions) {
    this.windowMs = opts.windowMs;
    this.max = opts.max;
  }

  check(key: string, now = Date.now()): RateLimitResult {
    this.maybePrune(now);

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { events: [] };
      this.buckets.set(key, bucket);
    }

    // Drop events outside the window
    const cutoff = now - this.windowMs;
    while (bucket.events.length > 0 && bucket.events[0] <= cutoff) {
      bucket.events.shift();
    }

    if (bucket.events.length >= this.max) {
      const oldest = bucket.events[0];
      const retryAfterMs = Math.max(0, oldest + this.windowMs - now);
      return {
        ok: false,
        remaining: 0,
        retryAfterMs,
      };
    }

    bucket.events.push(now);
    return {
      ok: true,
      remaining: this.max - bucket.events.length,
      retryAfterMs: 0,
    };
  }

  private maybePrune(now: number): void {
    if (now - this.lastPrune < this.pruneIntervalMs) return;
    this.lastPrune = now;
    const cutoff = now - this.windowMs;
    for (const [key, bucket] of this.buckets) {
      while (bucket.events.length > 0 && bucket.events[0] <= cutoff) {
        bucket.events.shift();
      }
      if (bucket.events.length === 0) {
        this.buckets.delete(key);
      }
    }
  }
}

// Helper: extract client IP from common proxy headers.
// Order: CF-Connecting-IP > X-Forwarded-For (first) > X-Real-IP > remoteAddr
export function clientIp(req: Request, remoteAddr?: string): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = req.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return remoteAddr ?? "0.0.0.0";
}

// Format milliseconds as a human "X minutes" string.
export function humanRetry(ms: number): string {
  const sec = Math.ceil(ms / 1000);
  if (sec < 60) return `${sec} second${sec === 1 ? "" : "s"}`;
  const min = Math.ceil(sec / 60);
  return `${min} minute${min === 1 ? "" : "s"}`;
}
