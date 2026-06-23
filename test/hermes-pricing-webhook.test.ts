import { createHmac } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { triggerHermesPricingWebhook } from "../lib/hermes-pricing-webhook";
import type { PricingJob } from "../lib/pricing-job";

const originalUrl = process.env.HERMES_PRICING_WEBHOOK_URL;
const originalSecret = process.env.HERMES_PRICING_WEBHOOK_SECRET;
const originalFetch = globalThis.fetch;

const job: PricingJob = {
  quoteId: "q-test-123",
  status: "pending",
  createdAt: "2026-06-22T00:00:00Z",
  productInput: {
    productId: "rain_event",
    customerName: "C",
    eventName: "E",
    locationName: "L",
    latitude: 1,
    longitude: 2,
    eventStart: "2030-01-01T00:00:00Z",
    eventEnd: "2030-01-01T06:00:00Z",
    desiredPayout: { amount: 500, currency: "USD" }
  }
};

afterEach(() => {
  if (originalUrl === undefined) delete process.env.HERMES_PRICING_WEBHOOK_URL;
  else process.env.HERMES_PRICING_WEBHOOK_URL = originalUrl;
  if (originalSecret === undefined) delete process.env.HERMES_PRICING_WEBHOOK_SECRET;
  else process.env.HERMES_PRICING_WEBHOOK_SECRET = originalSecret;
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("triggerHermesPricingWebhook", () => {
  it("skips when webhook env is not configured", async () => {
    delete process.env.HERMES_PRICING_WEBHOOK_URL;
    delete process.env.HERMES_PRICING_WEBHOOK_SECRET;
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(triggerHermesPricingWebhook(job)).resolves.toEqual({ attempted: false, reasonCode: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the pricing job with Hermes-compatible HMAC headers", async () => {
    process.env.HERMES_PRICING_WEBHOOK_URL = "http://localhost:8644/webhooks/pio-pricing";
    process.env.HERMES_PRICING_WEBHOOK_SECRET = "test-secret";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "accepted" }), { status: 202 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(triggerHermesPricingWebhook(job)).resolves.toEqual({ attempted: true, accepted: true, status: 202 });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:8644/webhooks/pio-pricing");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-GitHub-Event"]).toBe("pricing.job.created");
    expect(headers["X-GitHub-Delivery"]).toBeTruthy();

    const body = init.body as string;
    expect(JSON.parse(body)).toMatchObject({ event: "pricing.job.created", quoteId: "q-test-123", status: "pending" });
    const expectedSignature = `sha256=${createHmac("sha256", "test-secret").update(body).digest("hex")}`;
    expect(headers["X-Hub-Signature-256"]).toBe(expectedSignature);
  });
});
