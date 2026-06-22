import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ storeRef: {} as { current?: unknown } }));
vi.mock("../lib/policy-store-factory", () => ({
  getPolicyStore: () => hoisted.storeRef.current
}));

// Set env vars BEFORE importing the routes so HOLD_MS / POLL_MS consts read correctly
// (the wait route reads them inside the handler, but set here for safety)
const originalKey = process.env.PIO_OPERATOR_KEY;
const originalHold = process.env.PIO_PRICING_QUEUE_HOLD_MS;
const originalPoll = process.env.PIO_PRICING_QUEUE_POLL_MS;

process.env.PIO_OPERATOR_KEY = "op-key";
process.env.PIO_PRICING_QUEUE_HOLD_MS = "50";
process.env.PIO_PRICING_QUEUE_POLL_MS = "10";

import { GET as queueGet } from "../app/api/operator/pricing-queue/route";
import { GET as waitGet } from "../app/api/operator/pricing-queue/wait/route";
import { InMemoryPolicyStore } from "../lib/policy-store";
import type { PricingJob } from "../lib/pricing-job";

function makeJob(overrides: Partial<PricingJob> = {}): PricingJob {
  return {
    quoteId: "q-test-001",
    productInput: {
      productCode: "cargo",
      shipmentValue: 5000,
      routeRiskScore: 0.3
    } as never,
    status: "pending",
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function pricingRequest(key: string | null, url = "https://pio.test/api/operator/pricing-queue") {
  return new Request(url, {
    headers: key !== null ? { authorization: `Bearer ${key}` } : {}
  });
}

beforeEach(() => {
  process.env.PIO_OPERATOR_KEY = "op-key";
  process.env.PIO_PRICING_QUEUE_HOLD_MS = "50";
  process.env.PIO_PRICING_QUEUE_POLL_MS = "10";
  const store = new InMemoryPolicyStore();
  hoisted.storeRef.current = store;
});

// afterEach restores fast test-time values so no later test in this file can
// accidentally inherit the 25s production default.
afterEach(() => {
  process.env.PIO_OPERATOR_KEY = "op-key";
  process.env.PIO_PRICING_QUEUE_HOLD_MS = "50";
  process.env.PIO_PRICING_QUEUE_POLL_MS = "10";
});

// afterAll restores whatever was in the real environment before this file ran.
afterAll(() => {
  if (originalKey === undefined) delete process.env.PIO_OPERATOR_KEY;
  else process.env.PIO_OPERATOR_KEY = originalKey;
  if (originalHold === undefined) delete process.env.PIO_PRICING_QUEUE_HOLD_MS;
  else process.env.PIO_PRICING_QUEUE_HOLD_MS = originalHold;
  if (originalPoll === undefined) delete process.env.PIO_PRICING_QUEUE_POLL_MS;
  else process.env.PIO_PRICING_QUEUE_POLL_MS = originalPoll;
});

describe("GET /api/operator/pricing-queue", () => {
  it("returns seeded pending job with valid operator bearer", async () => {
    const store = hoisted.storeRef.current as InMemoryPolicyStore;
    const job = makeJob();
    await store.savePricingJob(job);

    const response = await queueGet(pricingRequest("op-key"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accepted).toBe(true);
    expect(body.jobs).toHaveLength(1);
    expect(body.jobs[0].quoteId).toBe("q-test-001");
  });

  it("returns 401 for missing bearer key", async () => {
    const response = await queueGet(pricingRequest(null));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.accepted).toBe(false);
    expect(body.reasonCode).toBe("unauthorized");
  });

  it("returns 401 for wrong bearer key", async () => {
    const response = await queueGet(pricingRequest("wrong-key"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.accepted).toBe(false);
    expect(body.reasonCode).toBe("unauthorized");
  });

  it("filters by since param — excludes job created before since", async () => {
    const store = hoisted.storeRef.current as InMemoryPolicyStore;
    const futureTs = new Date(Date.now() + 60_000).toISOString();
    await store.savePricingJob(makeJob({ createdAt: new Date(Date.now() - 5000).toISOString() }));

    const response = await queueGet(
      pricingRequest("op-key", `https://pio.test/api/operator/pricing-queue?since=${encodeURIComponent(futureTs)}`)
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.jobs).toHaveLength(0);
  });
});

describe("GET /api/operator/pricing-queue/wait", () => {
  it("returns 401 for missing bearer key", async () => {
    const response = await waitGet(
      pricingRequest(null, "https://pio.test/api/operator/pricing-queue/wait")
    );
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.reasonCode).toBe("unauthorized");
  });

  it("returns 401 for wrong bearer key", async () => {
    const response = await waitGet(
      pricingRequest("bad-key", "https://pio.test/api/operator/pricing-queue/wait")
    );
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.reasonCode).toBe("unauthorized");
  });

  it("returns empty jobs quickly when no job exists (hold=50ms)", async () => {
    const start = Date.now();
    const response = await waitGet(
      pricingRequest("op-key", "https://pio.test/api/operator/pricing-queue/wait")
    );
    const elapsed = Date.now() - start;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accepted).toBe(true);
    expect(body.jobs).toHaveLength(0);
    // Should return within ~200ms (hold is 50ms, with some slack)
    expect(elapsed).toBeLessThan(300);
  });

  it("returns job promptly when one exists", async () => {
    const store = hoisted.storeRef.current as InMemoryPolicyStore;
    await store.savePricingJob(makeJob());

    const start = Date.now();
    const response = await waitGet(
      pricingRequest("op-key", "https://pio.test/api/operator/pricing-queue/wait")
    );
    const elapsed = Date.now() - start;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accepted).toBe(true);
    expect(body.jobs).toHaveLength(1);
    // Should return very quickly since job is already there
    expect(elapsed).toBeLessThan(200);
  });
});
