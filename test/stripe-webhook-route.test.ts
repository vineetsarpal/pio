import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "../app/api/stripe/webhook/route";

const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

function checkoutCompletedPayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "evt_test_webhook_checkout_completed_123",
    type: "checkout.session.completed",
    created: 1781800123,
    data: {
      object: {
        id: "cs_test_webhook_123",
        payment_status: "paid",
        amount_total: 2500,
        currency: "usd",
        metadata: { policy_id: "pio-pol-2026-0001" },
        ...overrides
      }
    }
  });
}

function stripeRequest(payload: string, secret: string) {
  const timestamp = 1781800000;
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return new Request("https://pio.test/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
    body: payload
  });
}

afterEach(() => {
  if (originalWebhookSecret === undefined) {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  } else {
    process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret;
  }
});

describe("POST /api/stripe/webhook", () => {
  it("requires a configured Stripe webhook secret", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;

    const response = await POST(stripeRequest(checkoutCompletedPayload(), "whsec_demo"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      reasonCode: "stripe_webhook_not_configured"
    });
  });

  it("rejects invalid Stripe signatures", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_right";

    const response = await POST(stripeRequest(checkoutCompletedPayload(), "whsec_wrong"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      reasonCode: "invalid_stripe_signature"
    });
  });

  it("records a signed checkout.session.completed event as a premium_collected event", async () => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_right";

    const response = await POST(stripeRequest(checkoutCompletedPayload(), "whsec_right"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      demoMode: true,
      normalizedEvent: {
        providerEventId: "evt_test_webhook_checkout_completed_123",
        checkoutId: "cs_test_webhook_123",
        policyId: "pio-pol-2026-0001",
        amount: { amount: 25, currency: "USD" },
        mode: "stripe_test_mode"
      },
      policy: {
        id: "pio-pol-2026-0001",
        status: "premium_paid",
        stripePaymentReference: "cs_test_webhook_123"
      }
    });
  });
});
