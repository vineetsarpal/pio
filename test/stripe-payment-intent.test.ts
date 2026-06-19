import { describe, expect, it } from "vitest";
import {
  normalizeStripePaymentIntentFailedEvent,
  normalizeStripePaymentIntentSucceededEvent
} from "@/lib/stripe-payment-intent";

function paymentIntentSucceededEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_test_pi_succeeded_001",
    type: "payment_intent.succeeded",
    created: 1781800123,
    data: {
      object: {
        id: "pi_test_premium_0001",
        status: "succeeded",
        amount: 2500,
        amount_received: 2500,
        currency: "usd",
        customer: "cus_test_pio_seed",
        metadata: { policy_id: "pio-pol-2026-0001" },
        ...overrides
      }
    }
  };
}

describe("normalizeStripePaymentIntentSucceededEvent", () => {
  it("maps a succeeded off-session PaymentIntent to a premium_collected event", () => {
    const result = normalizeStripePaymentIntentSucceededEvent(paymentIntentSucceededEvent());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected normalization to succeed.");
    expect(result.premiumCollected).toEqual({
      providerEventId: "evt_test_pi_succeeded_001",
      checkoutId: "pi_test_premium_0001",
      policyId: "pio-pol-2026-0001",
      amount: { amount: 25, currency: "USD" },
      mode: "stripe_test_mode",
      paidAt: new Date(1781800123 * 1000).toISOString()
    });
  });

  it("rejects events that are not payment_intent.succeeded", () => {
    const result = normalizeStripePaymentIntentSucceededEvent(
      paymentIntentSucceededEvent() && { type: "charge.succeeded" }
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected rejection.");
    expect(result.reasonCode).toBe("unsupported_event_type");
  });

  it("rejects a PaymentIntent that is missing metadata.policy_id", () => {
    const result = normalizeStripePaymentIntentSucceededEvent(
      paymentIntentSucceededEvent({ metadata: {} })
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected rejection.");
    expect(result.reasonCode).toBe("missing_policy_metadata");
  });

  it("rejects a non-USD PaymentIntent", () => {
    const result = normalizeStripePaymentIntentSucceededEvent(
      paymentIntentSucceededEvent({ currency: "eur" })
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected rejection.");
    expect(result.reasonCode).toBe("unsupported_currency");
  });
});

function paymentIntentFailedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_test_pi_failed_001",
    type: "payment_intent.payment_failed",
    created: 1781800123,
    data: {
      object: {
        id: "pi_test_premium_0001",
        status: "requires_payment_method",
        currency: "usd",
        metadata: { policy_id: "pio-pol-2026-0001" },
        last_payment_error: {
          code: "authentication_required",
          message: "The payment requires authentication to proceed."
        },
        ...overrides
      }
    }
  };
}

describe("normalizeStripePaymentIntentFailedEvent (fail closed)", () => {
  it("surfaces the typed Stripe decline code for an off-session failure", () => {
    const result = normalizeStripePaymentIntentFailedEvent(paymentIntentFailedEvent());

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected failure normalization to succeed.");
    expect(result.failure).toEqual({
      providerEventId: "evt_test_pi_failed_001",
      paymentIntentId: "pi_test_premium_0001",
      policyId: "pio-pol-2026-0001",
      reasonCode: "authentication_required",
      message: "The payment requires authentication to proceed."
    });
  });

  it("falls back to off_session_payment_failed when Stripe omits a decline code", () => {
    const result = normalizeStripePaymentIntentFailedEvent(
      paymentIntentFailedEvent({ last_payment_error: null })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected failure normalization to succeed.");
    expect(result.failure.reasonCode).toBe("off_session_payment_failed");
  });

  it("rejects events that are not payment_intent.payment_failed", () => {
    const result = normalizeStripePaymentIntentFailedEvent(paymentIntentSucceededEvent());
    expect(result.ok).toBe(false);
  });
});
