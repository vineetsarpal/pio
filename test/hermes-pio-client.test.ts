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
});
