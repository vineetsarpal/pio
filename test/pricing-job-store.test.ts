import { describe, expect, it } from "vitest";
import { InMemoryPolicyStore } from "../lib/policy-store";
import type { PricingJob } from "../lib/pricing-job";
import { withProgress } from "../lib/pricing-job";
import type { ProductQuoteInput } from "../lib/coverage-products";

const input = { productId: "rain_event", customerName: "C", eventName: "E", locationName: "L",
  latitude: 1, longitude: 2, eventStart: "2030-01-01T00:00:00Z", eventEnd: "2030-01-01T06:00:00Z",
  desiredPayout: { amount: 500, currency: "USD" } } as ProductQuoteInput;

const job = (quoteId: string, createdAt: string, status: PricingJob["status"] = "pending"): PricingJob =>
  ({ quoteId, productInput: input, status, createdAt });

describe("PricingJob persistence (in-memory)", () => {
  it("saves, reads, and lists pending jobs newer than a cursor", async () => {
    const store = new InMemoryPolicyStore();
    await store.savePricingJob(job("q1", "2026-06-22T00:00:01Z"));
    await store.savePricingJob(job("q2", "2026-06-22T00:00:02Z"));
    await store.savePricingJob(job("q3", "2026-06-22T00:00:03Z", "priced"));

    expect((await store.getPricingJob("q1"))?.quoteId).toBe("q1");
    expect(await store.getPricingJob("missing")).toBeUndefined();

    const pending = await store.listPendingPricingJobs();
    expect(pending.map((j) => j.quoteId)).toEqual(["q1", "q2"]);

    const after = await store.listPendingPricingJobs("2026-06-22T00:00:01Z");
    expect(after.map((j) => j.quoteId)).toEqual(["q2"]);
  });

  it("upserts on quoteId (status transition pending -> priced)", async () => {
    const store = new InMemoryPolicyStore();
    await store.savePricingJob(job("q1", "2026-06-22T00:00:01Z"));
    await store.savePricingJob({ ...job("q1", "2026-06-22T00:00:01Z"), status: "priced", pricedAt: "2026-06-22T00:01:00Z" });
    expect((await store.getPricingJob("q1"))?.status).toBe("priced");
    expect(await store.listPendingPricingJobs()).toEqual([]);
  });

  it("withProgress appends to an empty or existing progress list", () => {
    const base = { quoteId: "q", productInput: {} as never, status: "pending" as const, createdAt: "2026-06-22T00:00:00Z" };
    const e1 = { at: "2026-06-22T00:00:01Z", source: "pio" as const, step: "weather_api_called" };
    const j1 = withProgress(base, e1);
    expect(j1.progress).toEqual([e1]);
    const e2 = { at: "2026-06-22T00:00:02Z", source: "operator" as const, step: "researching", detail: "Toronto rain" };
    expect(withProgress(j1, e2).progress).toEqual([e1, e2]);
    expect(base.progress).toBeUndefined(); // pure
  });

  it("listPricingJobs returns all jobs newest-first", async () => {
    const store = new InMemoryPolicyStore();
    await store.savePricingJob({ quoteId: "a", productInput: {} as never, status: "pending", createdAt: "2026-06-22T00:00:01Z" });
    await store.savePricingJob({ quoteId: "b", productInput: {} as never, status: "priced", createdAt: "2026-06-22T00:00:02Z" });
    expect((await store.listPricingJobs()).map((j) => j.quoteId)).toEqual(["b", "a"]);
  });
});
