import { describe, expect, it, vi } from "vitest";
import { PioClient } from "../hermes/pio-client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function clientWith(fetchMock: typeof fetch) {
  return new PioClient({
    baseUrl: "https://pio-platform.vercel.app",
    agentKey: "pio_seed_key_123",
    operatorKey: "pio_operator_key_123",
    fetchImpl: fetchMock
  });
}

describe("PioClient", () => {
  it("requests coverage without an auth header (quote is public)", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ accepted: true, reasonCode: "quote_ready" }));
    const client = clientWith(fetchMock as unknown as typeof fetch);

    const result = await client.requestCoverage({
      agentId: "a1",
      customerName: "North Pier",
      eventName: "Market",
      locationName: "Toronto",
      latitude: 43.6,
      longitude: -79.3,
      eventStart: "2027-06-19T12:00:00-04:00",
      eventEnd: "2027-06-19T18:00:00-04:00",
      desiredPayout: { amount: 500, currency: "USD" },
      purchaseIntent: "buy_if_within_budget"
    });

    expect(result).toMatchObject({ accepted: true, reasonCode: "quote_ready" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://pio-platform.vercel.app/api/agent/coverage-request");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it("confirms a purchase with the agent bearer key", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ accepted: true, reasonCode: "checkout_created" }));
    const client = clientWith(fetchMock as unknown as typeof fetch);

    await client.confirmPurchase({
      agentId: "a1",
      quoteId: "pio-pol-2026-0001",
      idempotencyKey: "k1",
      authorization: "confirm_purchase",
      coverageRequest: {
        customerName: "North Pier",
        eventName: "Market",
        locationName: "Toronto",
        latitude: 43.6,
        longitude: -79.3,
        eventStart: "2027-06-19T12:00:00-04:00",
        eventEnd: "2027-06-19T18:00:00-04:00",
        desiredPayout: { amount: 500, currency: "USD" }
      },
      maximumPremium: { amount: 50, currency: "USD" }
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://pio-platform.vercel.app/api/agent/confirm-purchase");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer pio_seed_key_123");
  });

  it("settles a policy with the operator bearer key", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ accepted: true, outcome: "payout_requested" }));
    const client = clientWith(fetchMock as unknown as typeof fetch);

    const result = await client.settlePolicy("pio-pol-2026-0001");

    expect(result).toMatchObject({ accepted: true, outcome: "payout_requested" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://pio-platform.vercel.app/api/operator/policy/pio-pol-2026-0001/settle");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer pio_operator_key_123");
  });

  it("reads the operator review queue with the operator key", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ reviews: [], source: "ledger_derived" }));
    const client = clientWith(fetchMock as unknown as typeof fetch);

    await client.getReviewQueue();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://pio-platform.vercel.app/api/operator/review-queue");
    expect(init.method ?? "GET").toBe("GET");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer pio_operator_key_123");
  });

  it("throws a labeled error when an operator call lacks the operator key", async () => {
    const client = new PioClient({ baseUrl: "https://pio-platform.vercel.app", agentKey: "k" });
    await expect(client.settlePolicy("p1")).rejects.toThrow("operatorKey is required");
  });

  it("waits for a pricing job with the operator key and forwards the since cursor", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ accepted: true, jobs: [] }));
    const client = clientWith(fetchMock as unknown as typeof fetch);

    await client.waitForPricingJob("2026-06-22T00:00:00Z");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://pio-platform.vercel.app/api/operator/pricing-queue/wait?since=2026-06-22T00%3A00%3A00Z"
    );
    expect(init.method ?? "GET").toBe("GET");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer pio_operator_key_123");
  });

  it("waits without a since cursor when none is given", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ accepted: true, jobs: [] }));
    const client = clientWith(fetchMock as unknown as typeof fetch);
    await client.waitForPricingJob();
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://pio-platform.vercel.app/api/operator/pricing-queue/wait");
  });

  it("submits a research memo to the price endpoint with the operator key", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ accepted: true, policy: { id: "pio-pol-rain-x" } }));
    const client = clientWith(fetchMock as unknown as typeof fetch);

    const memo = {
      riskScore: 0.6,
      evidence: [{ url: "https://x.test", title: "T", snippet: "s", retrievedAt: "2026-06-22T00:00:00Z" }],
      toolName: "Firecrawl"
    };
    await client.submitResearchQuote("pio-pol-rain-x", memo);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://pio-platform.vercel.app/api/operator/quote/pio-pol-rain-x/price");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer pio_operator_key_123");
    expect(JSON.parse(init.body as string)).toMatchObject({ riskScore: 0.6, toolName: "Firecrawl" });
  });

  it("throws when waitForPricingJob lacks the operator key", async () => {
    const client = new PioClient({ baseUrl: "https://pio-platform.vercel.app", agentKey: "k" });
    await expect(client.waitForPricingJob()).rejects.toThrow("operatorKey is required");
  });
});
