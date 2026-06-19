import type { PaymentMode, Policy, PremiumCollectedEvent } from "./types";

type StripePaymentIntentLike = {
  id?: unknown;
  type?: unknown;
  created?: unknown;
  data?: {
    object?: {
      id?: unknown;
      status?: unknown;
      amount?: unknown;
      amount_received?: unknown;
      currency?: unknown;
      metadata?: Record<string, unknown> | null;
      last_payment_error?: {
        code?: unknown;
        decline_code?: unknown;
        message?: unknown;
      } | null;
    };
  };
};

/**
 * A normalized off-session payment failure. `reasonCode` carries Stripe's typed
 * decline code (e.g. `authentication_required`) so the caller can fail closed —
 * never silently issuing a policy — and report exactly why the charge failed.
 */
export type PaymentIntentFailure = {
  providerEventId: string;
  paymentIntentId: string;
  policyId: string;
  reasonCode: string;
  message: string;
};

export type PaymentIntentFailureNormalizationResult =
  | { ok: true; failure: PaymentIntentFailure }
  | {
      ok: false;
      reasonCode: "unsupported_event_type" | "missing_policy_metadata" | "invalid_payment_intent_event";
      message: string;
    };

export type PaymentIntentNormalizationResult =
  | { ok: true; premiumCollected: PremiumCollectedEvent }
  | {
      ok: false;
      reasonCode:
        | "unsupported_event_type"
        | "payment_intent_not_succeeded"
        | "missing_policy_metadata"
        | "unsupported_currency"
        | "invalid_amount"
        | "invalid_payment_intent_event";
      message: string;
    };

/**
 * Normalize a Stripe `payment_intent.succeeded` event into the SAME
 * `PremiumCollectedEvent` shape the Checkout path produces. The PaymentIntent id
 * becomes `checkoutId`, which is the reference the premium_collected handler
 * dedupes on — so the off-session entrypoint shares idempotency and the
 * deterministic money core with `checkout.session.completed`.
 */
export function normalizeStripePaymentIntentSucceededEvent(event: unknown): PaymentIntentNormalizationResult {
  const stripeEvent = event as StripePaymentIntentLike;
  if (stripeEvent.type !== "payment_intent.succeeded") {
    return {
      ok: false,
      reasonCode: "unsupported_event_type",
      message: "Only payment_intent.succeeded events can become premium_collected events."
    };
  }

  const intent = stripeEvent.data?.object;
  if (!intent || typeof stripeEvent.id !== "string" || typeof intent.id !== "string") {
    return {
      ok: false,
      reasonCode: "invalid_payment_intent_event",
      message: "Stripe payment intent event is missing required id fields."
    };
  }

  if (intent.status !== "succeeded") {
    return {
      ok: false,
      reasonCode: "payment_intent_not_succeeded",
      message: "Payment intent has not succeeded."
    };
  }

  const policyId = intent.metadata?.policy_id;
  if (typeof policyId !== "string" || policyId.length === 0) {
    return {
      ok: false,
      reasonCode: "missing_policy_metadata",
      message: "Payment intent is missing metadata.policy_id."
    };
  }

  if (intent.currency !== "usd") {
    return {
      ok: false,
      reasonCode: "unsupported_currency",
      message: "PIO demo off-session charge only accepts USD payment intents."
    };
  }

  const amountInCents = typeof intent.amount_received === "number" ? intent.amount_received : intent.amount;
  if (typeof amountInCents !== "number" || !Number.isInteger(amountInCents)) {
    return {
      ok: false,
      reasonCode: "invalid_amount",
      message: "Payment intent amount must be an integer cent amount."
    };
  }

  const created = typeof stripeEvent.created === "number" ? stripeEvent.created : Math.floor(Date.now() / 1000);
  return {
    ok: true,
    premiumCollected: {
      providerEventId: stripeEvent.id,
      checkoutId: intent.id,
      policyId,
      amount: { amount: amountInCents / 100, currency: "USD" },
      mode: "stripe_test_mode",
      paidAt: new Date(created * 1000).toISOString()
    }
  };
}

/**
 * Normalize a Stripe `payment_intent.payment_failed` event into a typed
 * failure. Off-session charges that need a customer present (e.g.
 * `authentication_required`) land here; the caller MUST fail closed and never
 * advance the policy.
 */
export function normalizeStripePaymentIntentFailedEvent(event: unknown): PaymentIntentFailureNormalizationResult {
  const stripeEvent = event as StripePaymentIntentLike;
  if (stripeEvent.type !== "payment_intent.payment_failed") {
    return {
      ok: false,
      reasonCode: "unsupported_event_type",
      message: "Only payment_intent.payment_failed events describe an off-session charge failure."
    };
  }

  const intent = stripeEvent.data?.object;
  if (!intent || typeof stripeEvent.id !== "string" || typeof intent.id !== "string") {
    return {
      ok: false,
      reasonCode: "invalid_payment_intent_event",
      message: "Stripe payment intent event is missing required id fields."
    };
  }

  const policyId = intent.metadata?.policy_id;
  if (typeof policyId !== "string" || policyId.length === 0) {
    return {
      ok: false,
      reasonCode: "missing_policy_metadata",
      message: "Payment intent is missing metadata.policy_id."
    };
  }

  const error = intent.last_payment_error ?? undefined;
  const reasonCode =
    typeof error?.decline_code === "string"
      ? error.decline_code
      : typeof error?.code === "string"
        ? error.code
        : "off_session_payment_failed";
  const message =
    typeof error?.message === "string"
      ? error.message
      : "Off-session payment failed; no policy was issued.";

  return {
    ok: true,
    failure: {
      providerEventId: stripeEvent.id,
      paymentIntentId: intent.id,
      policyId,
      reasonCode,
      message
    }
  };
}

type OffSessionChargeInput = {
  policy: Policy;
  customerId: string;
  paymentMethodId: string;
  idempotencyKey?: string;
};

export type OffSessionChargeResult =
  | { ok: true; paymentIntent: { id: string; status: string } }
  | { ok: false; reasonCode: string; message: string; paymentIntentId?: string };

type StripePaymentIntentResponse = {
  id?: string;
  status?: string;
  error?: {
    code?: string;
    decline_code?: string;
    message?: string;
    payment_intent?: { id?: string };
  };
};

/**
 * Creates a confirmed, off-session PaymentIntent against a vaulted card — the
 * headless charge an agent makes with no browser. Following Stripe guidance for
 * off-session confirmation, `payment_method_types` is deliberately omitted so
 * Stripe selects the saved method. Any decline (notably `authentication_required`)
 * is returned as a typed failure; this adapter never throws on a declined card,
 * so the caller can fail closed and never issue a policy on a failed charge.
 */
export class LiveStripePaymentIntentAdapter {
  readonly mode: PaymentMode = "stripe_test_mode";
  private readonly secretKey: string;

  constructor(config: { secretKey: string }) {
    if (!config.secretKey) {
      throw new Error("STRIPE_SECRET_KEY is required to create off-session Stripe PaymentIntents.");
    }
    if (!config.secretKey.startsWith("sk_test_")) {
      throw new Error("PIO demo off-session charge only accepts Stripe test-mode secret keys.");
    }
    this.secretKey = config.secretKey;
  }

  async createOffSessionPaymentIntent(input: OffSessionChargeInput): Promise<OffSessionChargeResult> {
    const { policy, customerId, paymentMethodId } = input;
    const body = new URLSearchParams();
    body.set("amount", String(Math.round(policy.premium.amount * 100)));
    body.set("currency", policy.premium.currency.toLowerCase());
    body.set("customer", customerId);
    body.set("payment_method", paymentMethodId);
    body.set("confirm", "true");
    body.set("off_session", "true");
    body.set("metadata[policy_id]", policy.id);
    body.set("metadata[certificate_id]", policy.certificateId);

    let response: Response;
    try {
      response = await fetch("https://api.stripe.com/v1/payment_intents", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": input.idempotencyKey ?? `pio-offsession-${policy.id}`
        },
        body
      });
    } catch (error) {
      return {
        ok: false,
        reasonCode: "stripe_unreachable",
        message: error instanceof Error ? error.message : "Stripe PaymentIntent request failed."
      };
    }

    const payload = (await response.json()) as StripePaymentIntentResponse;

    if (payload.error) {
      return {
        ok: false,
        reasonCode: payload.error.decline_code ?? payload.error.code ?? "off_session_payment_failed",
        message: payload.error.message ?? `Off-session charge failed (HTTP ${response.status}).`,
        paymentIntentId: payload.error.payment_intent?.id
      };
    }

    if (!response.ok || !payload.id) {
      return {
        ok: false,
        reasonCode: "off_session_payment_failed",
        message: `Stripe PaymentIntent creation failed (HTTP ${response.status}).`
      };
    }

    if (payload.status !== "succeeded") {
      return {
        ok: false,
        reasonCode: payload.status === "requires_action" ? "authentication_required" : "off_session_payment_failed",
        message: `Off-session PaymentIntent is ${payload.status ?? "in an unexpected state"}, not succeeded.`,
        paymentIntentId: payload.id
      };
    }

    return { ok: true, paymentIntent: { id: payload.id, status: payload.status } };
  }
}

export function createLiveStripePaymentIntentAdapterFromEnv(): LiveStripePaymentIntentAdapter {
  return new LiveStripePaymentIntentAdapter({ secretKey: process.env.STRIPE_SECRET_KEY ?? "" });
}
