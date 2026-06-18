import { createHmac, timingSafeEqual } from "node:crypto";
import type { PremiumCollectedEvent } from "./types";

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
