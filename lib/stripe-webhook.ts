import { createHmac, timingSafeEqual } from "node:crypto";
import type { PayoutCompletedEvent, PayoutFailedEvent, PremiumCollectedEvent } from "./types";

type SignatureVerificationResult =
  | { ok: true; timestamp: number }
  | { ok: false; reason: "missing_signature" | "missing_timestamp" | "missing_v1" | "signature_mismatch" };

type StripeCheckoutCompletedLike = {
  id?: unknown;
  type?: unknown;
  created?: unknown;
  data?: {
    object?: {
      id?: unknown;
      payment_status?: unknown;
      amount_total?: unknown;
      currency?: unknown;
      metadata?: Record<string, unknown> | null;
    };
  };
};

type StripeCheckoutNormalizationResult =
  | { ok: true; premiumCollected: PremiumCollectedEvent }
  | {
      ok: false;
      reasonCode:
        | "unsupported_event_type"
        | "checkout_not_paid"
        | "missing_policy_metadata"
        | "unsupported_currency"
        | "invalid_amount"
        | "invalid_checkout_event";
      message: string;
    };

export function verifyStripeWebhookSignature(
  payload: string,
  signatureHeader: string | null,
  webhookSecret: string
): SignatureVerificationResult {
  if (!signatureHeader) return { ok: false, reason: "missing_signature" };

  const parts = signatureHeader.split(",").reduce<Record<string, string[]>>((acc, part) => {
    const [key, value] = part.split("=", 2);
    if (!key || !value) return acc;
    acc[key] = [...(acc[key] ?? []), value];
    return acc;
  }, {});
  const timestampRaw = parts.t?.[0];
  const signatures = parts.v1 ?? [];
  if (!timestampRaw) return { ok: false, reason: "missing_timestamp" };
  if (signatures.length === 0) return { ok: false, reason: "missing_v1" };

  const expected = createHmac("sha256", webhookSecret).update(`${timestampRaw}.${payload}`).digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const matches = signatures.some((signature) => {
    const signatureBuffer = Buffer.from(signature, "hex");
    return signatureBuffer.length === expectedBuffer.length && timingSafeEqual(signatureBuffer, expectedBuffer);
  });

  if (!matches) return { ok: false, reason: "signature_mismatch" };
  return { ok: true, timestamp: Number(timestampRaw) };
}

export function normalizeStripeCheckoutCompletedEvent(event: unknown): StripeCheckoutNormalizationResult {
  const stripeEvent = event as StripeCheckoutCompletedLike;
  if (stripeEvent.type !== "checkout.session.completed") {
    return {
      ok: false,
      reasonCode: "unsupported_event_type",
      message: "Only checkout.session.completed events can become premium_collected events."
    };
  }

  const session = stripeEvent.data?.object;
  if (!session || typeof stripeEvent.id !== "string" || typeof session.id !== "string") {
    return {
      ok: false,
      reasonCode: "invalid_checkout_event",
      message: "Stripe checkout event is missing required id fields."
    };
  }

  if (session.payment_status !== "paid") {
    return {
      ok: false,
      reasonCode: "checkout_not_paid",
      message: "Checkout session is not paid."
    };
  }

  const policyId = session.metadata?.policy_id;
  if (typeof policyId !== "string" || policyId.length === 0) {
    return {
      ok: false,
      reasonCode: "missing_policy_metadata",
      message: "Checkout session is missing metadata.policy_id."
    };
  }

  if (session.currency !== "usd") {
    return {
      ok: false,
      reasonCode: "unsupported_currency",
      message: "PIO demo webhook only accepts USD checkout sessions."
    };
  }

  if (typeof session.amount_total !== "number" || !Number.isInteger(session.amount_total)) {
    return {
      ok: false,
      reasonCode: "invalid_amount",
      message: "Checkout session amount_total must be an integer cent amount."
    };
  }

  const created = typeof stripeEvent.created === "number" ? stripeEvent.created : Math.floor(Date.now() / 1000);
  return {
    ok: true,
    premiumCollected: {
      providerEventId: stripeEvent.id,
      checkoutId: session.id,
      policyId,
      amount: { amount: session.amount_total / 100, currency: "USD" },
      mode: "stripe_test_mode",
      paidAt: new Date(created * 1000).toISOString()
    }
  };
}

type StripePayoutLike = {
  id?: unknown;
  type?: unknown;
  created?: unknown;
  data?: {
    object?: {
      id?: unknown;
      amount?: unknown;
      currency?: unknown;
      failure_message?: unknown;
      metadata?: Record<string, unknown> | null;
    };
  };
};

export type StripePayoutNormalizationResult =
  | { ok: true; type: "payout.paid"; completed: PayoutCompletedEvent }
  | { ok: true; type: "payout.failed"; failed: PayoutFailedEvent }
  | {
      ok: false;
      reasonCode:
        | "unsupported_event_type"
        | "invalid_payout_event"
        | "unsupported_currency"
        | "invalid_amount"
        | "missing_policy_metadata"
        | "missing_request_metadata";
      message: string;
    };

/**
 * Translate a signed Stripe `payout.paid` / `payout.failed` event into the
 * domain Money Event the ledger applies. The event id (`evt_…`) becomes the
 * Event Identity (`providerEventId`); the payout object id (`po_…`) is the
 * business reference; `policy_id` and `request_id` ride in payout metadata set
 * when the outbound payout was created.
 */
export function normalizeStripePayoutEvent(event: unknown): StripePayoutNormalizationResult {
  const stripeEvent = event as StripePayoutLike;
  if (stripeEvent.type !== "payout.paid" && stripeEvent.type !== "payout.failed") {
    return {
      ok: false,
      reasonCode: "unsupported_event_type",
      message: "Only payout.paid and payout.failed events can become payout money events."
    };
  }

  const payout = stripeEvent.data?.object;
  if (!payout || typeof stripeEvent.id !== "string" || typeof payout.id !== "string") {
    return { ok: false, reasonCode: "invalid_payout_event", message: "Stripe payout event is missing required id fields." };
  }

  if (payout.currency !== "usd") {
    return { ok: false, reasonCode: "unsupported_currency", message: "PIO demo webhook only accepts USD payouts." };
  }

  if (typeof payout.amount !== "number" || !Number.isInteger(payout.amount)) {
    return { ok: false, reasonCode: "invalid_amount", message: "Payout amount must be an integer cent amount." };
  }

  const policyId = payout.metadata?.policy_id;
  if (typeof policyId !== "string" || policyId.length === 0) {
    return { ok: false, reasonCode: "missing_policy_metadata", message: "Payout is missing metadata.policy_id." };
  }

  const requestId = payout.metadata?.request_id;
  if (typeof requestId !== "string" || requestId.length === 0) {
    return { ok: false, reasonCode: "missing_request_metadata", message: "Payout is missing metadata.request_id." };
  }

  const created = typeof stripeEvent.created === "number" ? stripeEvent.created : Math.floor(Date.now() / 1000);
  const at = new Date(created * 1000).toISOString();
  const amount = { amount: payout.amount / 100, currency: "USD" as const };

  if (stripeEvent.type === "payout.paid") {
    return {
      ok: true,
      type: "payout.paid",
      completed: {
        providerEventId: stripeEvent.id,
        requestId,
        payoutReference: payout.id,
        policyId,
        amount,
        mode: "stripe_test_mode",
        paidAt: at
      }
    };
  }

  const failureReason =
    typeof payout.failure_message === "string" && payout.failure_message.length > 0
      ? payout.failure_message
      : "stripe_payout_failed";
  return {
    ok: true,
    type: "payout.failed",
    failed: {
      providerEventId: stripeEvent.id,
      requestId,
      policyId,
      amount,
      mode: "stripe_test_mode",
      failedAt: at,
      failureReason
    }
  };
}
