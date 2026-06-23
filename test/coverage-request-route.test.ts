import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the policy store factory so dynamic branch uses an in-memory store
const hoisted = vi.hoisted(() => ({ storeRef: {} as { current?: unknown } }));
vi.mock("../lib/policy-store-factory", () => ({
  getPolicyStore: () => hoisted.storeRef.current
}));

// Mock quoteCoverageProduct to use DemoWeatherPricingApi (avoids live network calls in route tests)
vi.mock("../lib/coverage-products", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/coverage-products")>();
  return {
    ...actual,
    quoteCoverageProduct: (input: Parameters<typeof actual.quoteCoverageProduct>[0], _adapters: Parameters<typeof actual.quoteCoverageProduct>[1], options: Parameters<typeof actual.quoteCoverageProduct>[2]) =>
      actual.quoteCoverageProduct(input, { weather: new actual.DemoWeatherPricingApi() }, options)
  };
});

import { POST } from "../app/api/agent/coverage-request/route";
import { InMemoryPolicyStore } from "../lib/policy-store";

beforeEach(() => {
  hoisted.storeRef.current = new InMemoryPolicyStore();
});

const validDynamicBody = {
  pricing: "dynamic",
  productId: "rain_event",
  customerName: "Acme Corp",
  eventName: "Summer Festival",
  locationName: "Central Park",
  latitude: 40.785,
  longitude: -73.968,
  eventStart: "2030-07-01T14:00:00Z",
  eventEnd: "2030-07-01T20:00:00Z",
  desiredPayout: { amount: 1000, currency: "USD" }
};

describe("POST /api/agent/coverage-request (dynamic branch)", () => {
  it("returns 202 with quoteId and persists a pending pricing job", async () => {
    const response = await POST(
      new Request("https://pio.test/api/agent/coverage-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validDynamicBody)
      })
    );

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toMatchObject({
      accepted: true,
      reasonCode: "pricing_pending",
      status: "quote_requested"
    });
    expect(typeof body.quoteId).toBe("string");
    expect(body.quoteId.length).toBeGreaterThan(0);

    // Verify the job is persisted in the store
    const store = hoisted.storeRef.current as InMemoryPolicyStore;
    const job = await store.getPricingJob(body.quoteId);
    expect(job?.status).toBe("pending");
  });

  it("returns 400 for dynamic request with invalid event window", async () => {
    const response = await POST(
      new Request("https://pio.test/api/agent/coverage-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...validDynamicBody,
          // end before start → validation error
          eventStart: "2020-07-01T20:00:00Z",
          eventEnd: "2020-07-01T14:00:00Z"
        })
      })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.accepted).toBe(false);
    expect(body.reasonCode).toBe("invalid_dates");
  });

  it("returns 400 for dynamic request with missing required field", async () => {
    const { customerName: _omit, ...incomplete } = validDynamicBody;
    const response = await POST(
      new Request("https://pio.test/api/agent/coverage-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(incomplete)
      })
    );

    expect(response.status).toBe(400);
  });
});

describe("POST /api/agent/coverage-request (static / legacy branch)", () => {
  it("returns the legacy quote shape unchanged for a static request (no pricing field)", async () => {
    const response = await POST(
      new Request("https://pio.test/api/agent/coverage-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: "agent-001",
          customerName: "Acme Corp",
          eventName: "Summer Festival",
          locationName: "Central Park",
          latitude: 40.785,
          longitude: -73.968,
          eventStart: "2030-07-01T14:00:00Z",
          eventEnd: "2030-07-01T20:00:00Z",
          desiredPayout: { amount: 1000, currency: "USD" },
          purchaseIntent: "quote_only"
        })
      })
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      accepted: true,
      reasonCode: "quote_ready"
    });
    // Confirm dynamic fields are absent
    expect(body.status).toBeUndefined();
    expect(body.quoteId).toBeUndefined();
  });
});
