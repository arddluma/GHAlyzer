// Tiny in-memory token-bucket rate limiter. Not suitable for multi-instance
// deployments; swap for Redis/Upstash there.
const WINDOW_MS = 60_000;
const MAX_REQ_PER_WINDOW = 20;

// Global (all-IPs combined) limiter protects the server's GitHub quota.
const GLOBAL_WINDOW_MS = 60_000;
const GLOBAL_MAX_PER_WINDOW = 60;

// Unauthenticated public-scan limiter: tighter because GitHub's unauth API
// ceiling is 60 req/hour per IP and a single full scan eats ~15-30 of those.
const PUBLIC_WINDOW_MS = 10 * 60_000; // 10 minutes
const PUBLIC_MAX_PER_WINDOW = 3;

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
let globalBucket: Bucket = { count: 0, resetAt: Date.now() + GLOBAL_WINDOW_MS };

function hit(bucket: Bucket, max: number, windowMs: number, now: number) {
  if (bucket.resetAt < now) {
    bucket.count = 0;
    bucket.resetAt = now + windowMs;
  }
  if (bucket.count >= max) {
    return { ok: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count += 1;
  return { ok: true as const, retryAfterSec: 0 };
}

export function checkRateLimit(key: string): {
  ok: boolean;
  retryAfterSec: number;
} {
  const now = Date.now();
  // Per-IP (or fallback) limiter
  let perClient = buckets.get(key);
  if (!perClient) {
    perClient = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, perClient);
  }
  const perRes = hit(perClient, MAX_REQ_PER_WINDOW, WINDOW_MS, now);
  if (!perRes.ok) return perRes;

  // Global limiter
  const globalRes = hit(globalBucket, GLOBAL_MAX_PER_WINDOW, GLOBAL_WINDOW_MS, now);
  return globalRes;
}

/**
 * Separate, tighter limiter for unauthenticated public-scan requests. Keyed
 * under a `public:` namespace so it doesn't share buckets with the normal
 * authenticated flow.
 */
export function checkPublicRateLimit(key: string): {
  ok: boolean;
  retryAfterSec: number;
} {
  const now = Date.now();
  const nsKey = `public:${key}`;
  let b = buckets.get(nsKey);
  if (!b) {
    b = { count: 0, resetAt: now + PUBLIC_WINDOW_MS };
    buckets.set(nsKey, b);
  }
  return hit(b, PUBLIC_MAX_PER_WINDOW, PUBLIC_WINDOW_MS, now);
}

/**
 * Only trust forwarded-for / real-ip when running behind a known proxy.
 * Set TRUSTED_PROXY=1 in environments like Vercel, nginx, Cloudflare, etc.
 * Otherwise the attacker can freely spoof the key and bypass per-IP limits.
 */
export function clientKey(req: Request): string {
  const h = req.headers;
  if (process.env.TRUSTED_PROXY === "1") {
    const fwd =
      h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip");
    if (fwd) return fwd;
  }
  // No trusted proxy: fall back to a constant so the global limiter still
  // protects the server token. Per-IP granularity is impossible without
  // trusted headers.
  return "global";
}
