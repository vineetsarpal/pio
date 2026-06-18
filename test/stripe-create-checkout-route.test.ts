import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/stripe/create-checkout/route";
import { demoCoverageRequest } from "../lib/demo-fixtures";

const originalFetch = globalThis.fetch;
const originalStripeKey = process.env.STRIPE_SECRET_KEY;
const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalStripeKey === undefined) {
    delete process.env.STRIPE_SECRET_KEY;
  } else {
    process.env.STRIPE_SECRET_KEY = originalStripeKey;
  }
  process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  vi.restoreAllMocks();
});

describe("POST /api/stripe/create-checkout", () => {
  it("returns a safe configuration error when Stripe test key is missing", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    process.env.NEXT_PUBLIC_APP_URL = "https://pio.test";

    const response = await POST(
      new Request("https://pio.test/api/stripe/create-checkout", {
        method: "POST",
        body: JSON.stringify(demoCoverageRequest)
      })
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      reasonCode: "stripe_not_configured",
      demoMode: true
    });
  });

  it("returns a checkout URL for a valid coverage request with Stripe test mode configured", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_route_123";
    process.env.NEXT_PUBLIC_APP_URL = "https://pio.test";
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "cs_test_route_123",
          url: "https://checkout.stripe.com/c/pay/cs_test_route_123"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as typeof fetch;

    const response = await POST(
      new Request("https://pio.test/api/stripe/create-checkout", {
        method: "POST",
        body: JSON.stringify(demoCoverageRequest)
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      reasonCode: "checkout_created",
      checkout: {
        id: "cs_test_route_123",
        url: "https://checkout.stripe.com/c/pay/cs_test_route_123"
      },
      policy: {
        id: "pio-pol-2026-0001",
        premium: { amount: 25, currency: "USD" }
      }
    });
  });
});
