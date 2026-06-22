import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as confirmPurchase } from "../app/api/agent/confirm-purchase/route";
import { quotePolicy } from "../lib/workflow";
import { demoCoverageRequest } from "../lib/demo-fixtures";

const env = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  PIO_AGENT_SEED_KEY: process.env.PIO_AGENT_SEED_KEY,
  PIO_SEED_STRIPE_CUSTOMER: process.env.PIO_SEED_STRIPE_CUSTOMER,
  PIO_SEED_STRIPE_PAYMENT_METHOD: process.env.PIO_SEED_STRIPE_PAYMENT_METHOD
};

const quotedPolicy = quotePolicy(demoCoverageRequest);

function confirmBody() {
  return {
    agentId: "ops-agent-north-pier",
    quoteId: quotedPolicy.id,
    idempotencyKey: "confirm-001",
    authorization: "confirm_purchase",
    coverageRequest: {
      customerName: demoCoverageRequest.customerName,
      eventName: demoCoverageRequest.eventName,
      locationName: demoCoverageRequest.locationName,
      latitude: demoCoverageRequest.latitude,
      longitude: demoCoverageRequest.longitude,
      eventStart: demoCoverageRequest.eventStart,
      eventEnd: demoCoverageRequest.eventEnd,
      desiredPayout: demoCoverageRequest.desiredPayout
    },
    maximumPremium: { amount: 50, currency: "USD" }
  };
}

function confirmRequest(key: string | undefined = "pio_seed_key_123") {
  return new Request("https://pio.test/api/agent/confirm-purchase", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(key ? { authorization: `Bearer ${key}` } : {})
    },
    body: JSON.stringify(confirmBody())
  });
}

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_demo";
  process.env.NEXT_PUBLIC_APP_URL = "https://pio.test";
  process.env.PIO_AGENT_SEED_KEY = "pio_seed_key_123";
  process.env.PIO_SEED_STRIPE_CUSTOMER = "cus_test_seed";
  process.env.PIO_SEED_STRIPE_PAYMENT_METHOD = "pm_card_visa";
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("agent confirm-purchase route", () => {
  it("rejects an unauthenticated confirmation with 401", async () => {
    const response = await confirmPurchase(confirmRequest("wrong_key"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ accepted: false, reasonCode: "unauthorized" });
  });

  it("creates a real Stripe checkout for an authenticated agent within budget", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "https://api.stripe.com/v1/customers") {
          return new Response(JSON.stringify({ id: "cus_test_live_agent" }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            id: "cs_test_live_agent_999",
            url: "https://checkout.stripe.com/c/pay/cs_test_live_agent_999"
          }),
          { status: 200 }
        );
      })
    );

    const response = await confirmPurchase(confirmRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      accepted: true,
      reasonCode: "checkout_created",
      checkout: {
        id: "cs_test_live_agent_999",
        url: "https://checkout.stripe.com/c/pay/cs_test_live_agent_999",
        mode: "stripe_test_mode"
      }
    });
  });

  it("returns 503 when Stripe is not configured", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const response = await confirmPurchase(confirmRequest());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ reasonCode: "stripe_not_configured" });
  });
});
