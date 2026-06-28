import { describe, expect, it } from "vitest";
import { clientIp, createRateLimiter } from "../lib/rate-limit";

describe("createRateLimiter", () => {
  it("allows up to `limit` hits in a window then rejects", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000 });
    let now = 0;
    const clock = () => now;
    expect(limiter.check("a", clock).allowed).toBe(true);
    expect(limiter.check("a", clock).allowed).toBe(true);
    const third = limiter.check("a", clock);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
    const fourth = limiter.check("a", clock);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSeconds).toBe(1);
  });

  it("resets after the window elapses", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    let now = 0;
    const clock = () => now;
    expect(limiter.check("a", clock).allowed).toBe(true);
    expect(limiter.check("a", clock).allowed).toBe(false);
    now = 1000;
    expect(limiter.check("a", clock).allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    const clock = () => 0;
    expect(limiter.check("a", clock).allowed).toBe(true);
    expect(limiter.check("b", clock).allowed).toBe(true);
    expect(limiter.check("a", clock).allowed).toBe(false);
  });
});

describe("clientIp", () => {
  it("reads the first hop from x-forwarded-for", () => {
    const req = new Request("https://x.test", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
    expect(clientIp(req)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip then a constant", () => {
    const req = new Request("https://x.test", { headers: { "x-real-ip": "9.9.9.9" } });
    expect(clientIp(req)).toBe("9.9.9.9");
    expect(clientIp(new Request("https://x.test"))).toBe("unknown");
  });
});
