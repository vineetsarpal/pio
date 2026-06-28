/**
 * Minimal in-memory fixed-window rate limiter for the public, unauthenticated
 * routes that cost money to serve (the dynamic-pricing intake and the
 * third-party geocode/flight lookups). It blunts a single abusive client per
 * function instance.
 *
 * Caveat: on Vercel each function instance keeps its own counters, so this is
 * not a globally-consistent limit. It is the in-app backstop; the edge-wide
 * limit is the Vercel Firewall (configured in the dashboard, see step (b)).
 */
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string, clock?: () => number): RateLimitResult;
}

interface Window {
  count: number;
  resetAt: number;
}

export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }): RateLimiter {
  const windows = new Map<string, Window>();

  return {
    check(key, clock = Date.now): RateLimitResult {
      const now = clock();
      const existing = windows.get(key);
      if (!existing || now >= existing.resetAt) {
        const resetAt = now + windowMs;
        windows.set(key, { count: 1, resetAt });
        // Opportunistic sweep so the map can't grow unbounded under churn.
        if (windows.size > 10_000) {
          for (const [k, w] of windows) if (now >= w.resetAt) windows.delete(k);
        }
        return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
      }
      if (existing.count >= limit) {
        return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000) };
      }
      existing.count += 1;
      return { allowed: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
    }
  };
}

/** Best-effort client IP from the proxy headers Vercel sets. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}
