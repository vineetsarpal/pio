import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ storeRef: {} as { current?: unknown } }));
vi.mock("../lib/policy-store-factory", () => ({
  getPolicyStore: () => hoisted.storeRef.current
}));

import { POST as price } from "../app/api/operator/quote/[quoteId]/price/route";
import { InMemoryPolicyStore } from "../lib/policy-store";
import { createDynamicPricingJob } from "../lib/operator-research-pricing";

const originalKey = process.env.PIO_OPERATOR_KEY;

async function seedJob(store: InMemoryPolicyStore) {
  const input = { productId: "rain_event", customerName: "C", eventName: "E", locationName: "L",
    latitude: 1, longitude: 2, eventStart: "2030-01-01T00:00:00Z", eventEnd: "2030-01-01T06:00:00Z",
    desiredPayout: { amount: 500, currency: "USD" } } as never;
  return createDynamicPricingJob(input, { store, now: "2026-06-22T00:00:00Z" });
}

function priceRequest(quoteId: string, key: string | undefined = "pio_operator_key_123", memo?: object) {
  return new Request(`https://pio.test/api/operator/quote/${quoteId}/price`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { authorization: `Bearer ${key}` } : {})
    },
    body: JSON.stringify(memo ?? {
      riskScore: 0.5,
      evidence: [{ url: "https://x.test", title: "T", snippet: "s", retrievedAt: "2026-06-22T00:00:30Z" }],
      toolName: "Firecrawl search"
    })
  });
}

beforeEach(() => {
  hoisted.storeRef.current = new InMemoryPolicyStore();
  process.env.PIO_OPERATOR_KEY = "pio_operator_key_123";
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.PIO_OPERATOR_KEY;
  else process.env.PIO_OPERATOR_KEY = originalKey;
});

describe("POST /api/operator/quote/[quoteId]/price", () => {
  it("rejects an unauthenticated operator with 401", async () => {
    const store = hoisted.storeRef.current as InMemoryPolicyStore;
    const { quoteId } = await seedJob(store);
    const response = await price(priceRequest(quoteId, "wrong_key"), {
      params: Promise.resolve({ quoteId })
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ reasonCode: "unauthorized" });
  });

  it("returns 404 for an unknown quote", async () => {
    const response = await price(priceRequest("nope"), {
      params: Promise.resolve({ quoteId: "nope" })
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ reasonCode: "job_not_found" });
  });

  it("returns 200 and priced policy for a seeded job", async () => {
    const store = hoisted.storeRef.current as InMemoryPolicyStore;
    const { quoteId } = await seedJob(store);
    const response = await price(priceRequest(quoteId), {
      params: Promise.resolve({ quoteId })
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accepted).toBe(true);
    expect(body.policy.pricedBy).toBe("operator_research");
    expect(body.policy.status).toBe("policy_quoted");
  });
});
