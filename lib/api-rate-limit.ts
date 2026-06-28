import { NextResponse } from "next/server";
import { clientIp, createRateLimiter, type RateLimiter } from "./rate-limit";

/**
 * Per-instance limiters for the public, unauthenticated routes. Keyed by client
 * IP. These are module-level so they persist across invocations within a warm
 * function instance. See lib/rate-limit.ts for the per-instance caveat — the
 * edge-wide limit is the Vercel Firewall.
 *
 * Tiers: third-party-cost routes (geocode/flights) get a modest budget; the
 * dynamic-pricing intake is tighter since each accepted call spends agent
 * budget downstream (and is additionally bounded by the pricing-queue cap).
 */
export const intakeLimiter: RateLimiter = createRateLimiter({ limit: 8, windowMs: 60_000 });
export const lookupLimiter: RateLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });
export const quoteLimiter: RateLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

/**
 * Returns a 429 NextResponse if the request exceeds the limiter, otherwise null.
 * Call at the top of a route handler: `const limited = rateLimit(request, x); if (limited) return limited;`
 */
export function rateLimit(request: Request, limiter: RateLimiter): NextResponse | null {
  const result = limiter.check(clientIp(request));
  if (result.allowed) return null;
  return NextResponse.json(
    { error: "rate_limited", message: "Too many requests. Please slow down." },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } }
  );
}
