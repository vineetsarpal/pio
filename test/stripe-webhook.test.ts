import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  normalizeStripeCheckoutCompletedEvent,
  normalizeStripePayoutEvent,
  verifyStripeWebhookSignature
} from "../lib/stripe-webhook";

function signPayload(payload: string, secret: string, timestamp = 1781800000) {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

describe("verifyStripeWebhookSignature", () => {
  it("accepts a Stripe-style timestamped HMAC signature", () => {
    const payload = JSON.stringify({ id: "evt_test_123", type: "checkout.session.completed" });
    const header = signPayload(payload, "whsec_test_secret");

    expect(verifyStripeWebhookSignature(payload, header, "whsec_test_secret")).toEqual({
      ok: true,
      timestamp: 1781800000
    });
  });

  it("rejects a bad signature without parsing the event as trusted", () => {
    const payload = JSON.stringify({ id: "evt_test_123", type: "checkout.session.completed" });

    expect(verifyStripeWebhookSignature(payload, "t=1781800000,v1=bad", "whsec_test_secret")).toEqual({
      ok: false,
      reason: "signature_mismatch"
    });
  });
});

describe("normalizeStripeCheckoutCompletedEvent", () => {
  it("maps checkout.session.completed to PIO premium_collected facts", () => {
    const event = {
      id: "evt_test_checkout_completed_123",
      type: "checkout.session.completed",
      created: 1781800123,
      data: {
        object: {
          id: "cs_test_checkout_123",
          object: "checkout.session",
          payment_status: "paid",
          amount_total: 2500,
          currency: "usd",
          metadata: {
            policy_id: "pio-pol-2026-0001"
          }
        }
      }
    };

    expect(normalizeStripeCheckoutCompletedEvent(event)).toEqual({
      ok: true,
      premiumCollected: {
        providerEventId: "evt_test_checkout_completed_123",
        checkoutId: "cs_test_checkout_123",
        policyId: "pio-pol-2026-0001",
        amount: { amount: 25, currency: "USD" },
        mode: "stripe_test_mode",
        paidAt: "2026-06-18T16:28:43.000Z"
      }
    });
  });

  it("rejects unpaid checkout completion events", () => {
    const event = {
      id: "evt_unpaid",
      type: "checkout.session.completed",
      created: 1781800123,
      data: {
        object: {
          id: "cs_test_unpaid",
          payment_status: "unpaid",
          amount_total: 2500,
          currency: "usd",
          metadata: { policy_id: "pio-pol-2026-0001" }
        }
      }
    };

    expect(normalizeStripeCheckoutCompletedEvent(event)).toMatchObject({
      ok: false,
      reasonCode: "checkout_not_paid"
    });
  });

  it("rejects checkout events without policy metadata", () => {
    const event = {
      id: "evt_missing_policy",
      type: "checkout.session.completed",
      created: 1781800123,
      data: {
        object: {
          id: "cs_test_missing_policy",
          payment_status: "paid",
          amount_total: 2500,
          currency: "usd",
          metadata: {}
        }
      }
    };

    expect(normalizeStripeCheckoutCompletedEvent(event)).toMatchObject({
      ok: false,
      reasonCode: "missing_policy_metadata"
    });
  });
});

describe("normalizeStripePayoutEvent", () => {
  function payoutEvent(type: string, overrides: Record<string, unknown> = {}) {
    return {
      id: "evt_test_payout_001",
      type,
      created: 1781800123,
      data: {
        object: {
          id: "po_test_001",
          object: "payout",
          amount: 50000,
          currency: "usd",
          status: type === "payout.paid" ? "paid" : "failed",
          metadata: { policy_id: "pio-pol-2026-0001", request_id: "payout-request-pio-pol-2026-0001" },
          ...overrides
        }
      }
    };
  }

  it("normalizes a payout.paid event into a PayoutCompletedEvent", () => {
    expect(normalizeStripePayoutEvent(payoutEvent("payout.paid"))).toEqual({
      ok: true,
      type: "payout.paid",
      completed: {
        providerEventId: "evt_test_payout_001",
        requestId: "payout-request-pio-pol-2026-0001",
        payoutReference: "po_test_001",
        policyId: "pio-pol-2026-0001",
        amount: { amount: 500, currency: "USD" },
        mode: "stripe_test_mode",
        paidAt: "2026-06-18T16:28:43.000Z"
      }
    });
  });

  it("normalizes a payout.failed event with its failure message", () => {
    expect(
      normalizeStripePayoutEvent(payoutEvent("payout.failed", { failure_message: "account_closed" }))
    ).toEqual({
      ok: true,
      type: "payout.failed",
      failed: {
        providerEventId: "evt_test_payout_001",
        requestId: "payout-request-pio-pol-2026-0001",
        policyId: "pio-pol-2026-0001",
        amount: { amount: 500, currency: "USD" },
        mode: "stripe_test_mode",
        failedAt: "2026-06-18T16:28:43.000Z",
        failureReason: "account_closed"
      }
    });
  });

  it("rejects unsupported event types", () => {
    expect(normalizeStripePayoutEvent(payoutEvent("payout.updated"))).toMatchObject({
      ok: false,
      reasonCode: "unsupported_event_type"
    });
  });

  it("rejects a payout missing request metadata", () => {
    expect(
      normalizeStripePayoutEvent(payoutEvent("payout.paid", { metadata: { policy_id: "pio-pol-2026-0001" } }))
    ).toMatchObject({ ok: false, reasonCode: "missing_request_metadata" });
  });
});
