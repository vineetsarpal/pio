import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { LiveStripeCheckoutAdapter } from "../lib/stripe-checkout";
import { quotePolicy } from "../lib/workflow";
import { demoCoverageRequest } from "../lib/demo-fixtures";

describe("LiveStripeCheckoutAdapter", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("refuses to initialize without a Stripe secret key", () => {
    expect(() => new LiveStripeCheckoutAdapter({ secretKey: "", appUrl: "https://pio.test" })).toThrow(
      "STRIPE_SECRET_KEY is required"
    );
  });

  it("creates a Stripe Checkout Session with policy metadata, premium cents, and idempotency", async () => {
    const policy = quotePolicy(demoCoverageRequest);
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "cs_test_live_123",
          url: "https://checkout.stripe.com/c/pay/cs_test_live_123"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const adapter = new LiveStripeCheckoutAdapter({
      secretKey: "sk_test_123",
      appUrl: "https://pio.test"
    });

    const checkout = await adapter.createCheckout(policy, { id: "cus_local", name: policy.customerName });

    expect(checkout).toEqual({
      id: "cs_test_live_123",
      url: "https://checkout.stripe.com/c/pay/cs_test_live_123",
      premium: policy.premium,
      mode: "stripe_test_mode"
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer sk_test_123",
      "Idempotency-Key": `pio-checkout-${policy.id}`
    });
    const body = init.body as URLSearchParams;
    expect(body.get("mode")).toBe("payment");
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("2500");
    expect(body.get("line_items[0][price_data][currency]")).toBe("usd");
    expect(body.get("metadata[policy_id]")).toBe(policy.id);
    expect(body.get("metadata[certificate_id]")).toBe(policy.certificateId);
    expect(body.get("success_url")).toBe("https://pio.test/buy/success?session_id={CHECKOUT_SESSION_ID}&policy_id=pio-pol-2026-0001");
    expect(body.get("cancel_url")).toBe("https://pio.test/buy?checkout=cancelled&policy_id=pio-pol-2026-0001");
  });

  it("allows callers to provide a fresh idempotency key for a checkout attempt", async () => {
    const policy = quotePolicy(demoCoverageRequest);
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "cs_test_fresh_attempt",
          url: "https://checkout.stripe.com/c/pay/cs_test_fresh_attempt"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const adapter = new LiveStripeCheckoutAdapter({
      secretKey: "sk_test_123",
      appUrl: "https://pio.test"
    });

    await adapter.createCheckout(
      policy,
      { id: "cus_local", name: policy.customerName },
      { idempotencyKey: "pio-buy-checkout-pio-pol-2026-0001-attempt-1" }
    );

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({
      "Idempotency-Key": "pio-buy-checkout-pio-pol-2026-0001-attempt-1"
    });
  });

  it("surfaces Stripe API failures without returning an unsafe checkout", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "No such API key" } }), {
        status: 401,
        headers: { "content-type": "application/json" }
      })
    ) as typeof fetch;

    const adapter = new LiveStripeCheckoutAdapter({
      secretKey: "sk_test_bad",
      appUrl: "https://pio.test"
    });

    await expect(
      adapter.createCheckout(quotePolicy(demoCoverageRequest), { id: "cus_local", name: "North Pier" })
    ).rejects.toThrow("Stripe Checkout Session creation failed: No such API key");
  });
});
