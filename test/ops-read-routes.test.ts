import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ storeRef: {} as { current?: unknown } }));
vi.mock("../lib/policy-store-factory", () => ({
  getPolicyStore: () => hoisted.storeRef.current
}));

import { GET as quoteStatus } from "../app/api/ops/quote-status/[quoteId]/route";
import { GET as pricingFeed } from "../app/api/ops/pricing-feed/route";
import { InMemoryPolicyStore } from "../lib/policy-store";
import { createDynamicPricingJob, pricePricingJob } from "../lib/operator-research-pricing";
import { DemoWeatherPricingApi } from "../lib/coverage-products";

async function seedJob(store: InMemoryPolicyStore, payout = 500) {
  const input = { productId: "rain_event", customerName: "C", eventName: "Harbor Market", locationName: "Toronto",
    latitude: 1, longitude: 2, eventStart: "2030-01-01T00:00:00Z", eventEnd: "2030-01-01T06:00:00Z",
    desiredPayout: { amount: payout, currency: "USD" } } as never;
  return createDynamicPricingJob(input, { store, now: "2026-06-22T00:00:00Z", adapters: { weather: new DemoWeatherPricingApi() } });
}

beforeEach(() => {
  hoisted.storeRef.current = new InMemoryPolicyStore();
});

describe("GET /api/ops/quote-status/[quoteId]", () => {
  it("returns 404 for an unknown quoteId", async () => {
    const response = await quoteStatus(new Request("https://pio.test/api/ops/quote-status/unknown"), {
      params: Promise.resolve({ quoteId: "unknown" })
    });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.found).toBe(false);
  });

  it("returns 200 with quote_requested status for a pending job", async () => {
    const store = hoisted.storeRef.current as InMemoryPolicyStore;
    const { quoteId } = await seedJob(store);
    const response = await quoteStatus(new Request(`https://pio.test/api/ops/quote-status/${quoteId}`), {
      params: Promise.resolve({ quoteId })
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accepted).toBe(true);
    expect(body.found).toBe(true);
    expect(body.status).toBe("quote_requested");
  });

  it("returns policy_quoted status for a priced job", async () => {
    const store = hoisted.storeRef.current as InMemoryPolicyStore;
    const { quoteId } = await seedJob(store);
    await pricePricingJob(
      { quoteId, now: "2026-06-22T00:01:00Z", memo: { riskScore: 0.5, evidence: [], toolName: "test" } },
      { store, adapters: { weather: new DemoWeatherPricingApi() } }
    );
    const response = await quoteStatus(new Request(`https://pio.test/api/ops/quote-status/${quoteId}`), {
      params: Promise.resolve({ quoteId })
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("policy_quoted");
    expect(body.premium).toBeDefined();
  });
});

describe("GET /api/ops/pricing-feed", () => {
  it("returns empty partitions when no jobs exist", async () => {
    const response = await pricingFeed(new Request("https://pio.test/api/ops/pricing-feed"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accepted).toBe(true);
    expect(body.pending).toEqual([]);
    expect(body.recentlyPriced).toEqual([]);
  });

  it("returns pending and recentlyPriced partitions", async () => {
    const store = hoisted.storeRef.current as InMemoryPolicyStore;
    const { quoteId: pendingId } = await seedJob(store, 500);
    const { quoteId: pricedId } = await seedJob(store, 600);
    await pricePricingJob(
      { quoteId: pricedId, now: "2026-06-22T00:01:00Z", memo: { riskScore: 0.5, evidence: [], toolName: "test" } },
      { store, adapters: { weather: new DemoWeatherPricingApi() } }
    );
    const response = await pricingFeed(new Request("https://pio.test/api/ops/pricing-feed"));
    const body = await response.json();
    expect(body.pending.map((r: { quoteId: string }) => r.quoteId)).toContain(pendingId);
    expect(body.recentlyPriced.map((r: { quoteId: string }) => r.quoteId)).toContain(pricedId);
    expect(body.pending[0].eventName).toBe("Harbor Market");
    expect(body.recentlyPriced[0].premium).toBeDefined();
  });
});
