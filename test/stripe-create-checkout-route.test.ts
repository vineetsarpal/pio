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

  it("uses a fresh Stripe idempotency key for each buy checkout request", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_route_123";
    process.env.NEXT_PUBLIC_APP_URL = "https://pio.test";
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "cs_test_route_123",
          url: "https://checkout.stripe.com/c/pay/cs_test_route_123"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await POST(
      new Request("https://pio.test/api/stripe/create-checkout", {
        method: "POST",
        body: JSON.stringify(demoCoverageRequest)
      })
    );
    await POST(
      new Request("https://pio.test/api/stripe/create-checkout", {
        method: "POST",
        body: JSON.stringify(demoCoverageRequest)
      })
    );

    const firstHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    const secondHeaders = fetchMock.mock.calls[1][1]?.headers as Record<string, string>;
    expect(firstHeaders["Idempotency-Key"]).toMatch(/^pio-buy-checkout-pio-pol-2026-0001-/);
    expect(secondHeaders["Idempotency-Key"]).toMatch(/^pio-buy-checkout-pio-pol-2026-0001-/);
    expect(firstHeaders["Idempotency-Key"]).not.toBe(secondHeaders["Idempotency-Key"]);
  });

  it("creates checkout for a product-aware rain quote", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_route_123";
    process.env.NEXT_PUBLIC_APP_URL = "https://pio.test";
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).startsWith("https://api.open-meteo.com")) {
        return new Response(
          JSON.stringify({
            hourly: {
              time: ["2026-06-20T12:00", "2026-06-20T13:00", "2026-06-20T14:00"],
              rain: [2, 2, 2]
            }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          id: "cs_test_product_rain_123",
          url: "https://checkout.stripe.com/c/pay/cs_test_product_rain_123"
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as typeof fetch;

    const response = await POST(
      new Request("https://pio.test/api/stripe/create-checkout", {
        method: "POST",
        body: JSON.stringify({
          productId: "rain_event",
          customerName: "North Pier Pop-up Market",
          eventName: "Saturday Harbor Market",
          locationName: "Toronto Waterfront",
          latitude: 43.6405,
          longitude: -79.3764,
          eventStart: "2026-06-20T12:00:00-04:00",
          eventEnd: "2026-06-20T18:00:00-04:00",
          desiredPayout: { amount: 500, currency: "USD" },
          maximumPremium: { amount: 120, currency: "USD" }
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      reasonCode: "checkout_created",
      productQuote: {
        product: { id: "rain_event" },
        policy: { productId: "rain_event" }
      },
      checkout: {
        id: "cs_test_product_rain_123",
        url: "https://checkout.stripe.com/c/pay/cs_test_product_rain_123"
      }
    });
  });
});
