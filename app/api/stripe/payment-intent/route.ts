import { NextResponse } from "next/server";
import { handlePolicyIssuanceEvent, handlePremiumCollectedEvent } from "@/lib/payment-events";
import { getPolicyStore } from "@/lib/policy-store-factory";
import { verifyStripeWebhookSignature } from "@/lib/stripe-webhook";
import {
  normalizeStripePaymentIntentFailedEvent,
  normalizeStripePaymentIntentSucceededEvent
} from "@/lib/stripe-payment-intent";

/**
 * Off-session PaymentIntent webhook. The verified event — never the synchronous
 * confirm response — is the payment truth that advances the policy. A
 * `payment_intent.succeeded` normalizes into the SAME premium_collected event as
 * the Checkout path, then this entrypoint issues the policy. A
 * `payment_intent.payment_failed` fails closed with a typed reason code and
 * issues nothing.
 */
export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json(
      {
        accepted: false,
        reasonCode: "stripe_webhook_not_configured",
        demoMode: true,
        message: "STRIPE_WEBHOOK_SECRET is required to verify Stripe webhook events."
      },
      { status: 503 }
    );
  }

  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  const verification = verifyStripeWebhookSignature(rawBody, signature, webhookSecret);
  if (!verification.ok) {
    return NextResponse.json(
      {
        accepted: false,
        reasonCode: "invalid_stripe_signature",
        demoMode: true,
        message: `Stripe webhook signature verification failed: ${verification.reason}`
      },
      { status: 400 }
    );
  }

  const event = JSON.parse(rawBody) as { type?: unknown };

  if (event.type === "payment_intent.payment_failed") {
    const failure = normalizeStripePaymentIntentFailedEvent(event);
    if (!failure.ok) {
      return NextResponse.json(
        { accepted: false, reasonCode: failure.reasonCode, demoMode: true, message: failure.message },
        { status: 422 }
      );
    }
    // Fail closed: surface the typed decline code, issue no policy.
    return NextResponse.json(
      {
        accepted: false,
        reasonCode: failure.failure.reasonCode,
        demoMode: true,
        policyIssued: false,
        message: failure.failure.message,
        failure: failure.failure
      },
      { status: 200 }
    );
  }

  const normalized = normalizeStripePaymentIntentSucceededEvent(event);
  if (!normalized.ok) {
    return NextResponse.json(
      { accepted: false, reasonCode: normalized.reasonCode, demoMode: true, message: normalized.message },
      { status: 422 }
    );
  }

  const store = getPolicyStore();
  const premium = await handlePremiumCollectedEvent(normalized.premiumCollected, store);
  if (!premium.accepted) {
    return NextResponse.json(
      { ...premium, demoMode: true, normalizedEvent: normalized.premiumCollected },
      { status: 422 }
    );
  }

  const issuance = await handlePolicyIssuanceEvent(
    { policyId: normalized.premiumCollected.policyId, issuedAt: normalized.premiumCollected.paidAt },
    store
  );

  return NextResponse.json(
    {
      accepted: issuance.accepted,
      reasonCode: issuance.accepted ? "policy_issued" : issuance.reasonCode,
      demoMode: true,
      policy: issuance.accepted ? issuance.policy : premium.policy,
      paymentEvent: premium.paymentEvent,
      normalizedEvent: normalized.premiumCollected
    },
    { status: issuance.accepted ? 200 : 422 }
  );
}
