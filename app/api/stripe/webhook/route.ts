import { NextResponse } from "next/server";
import { handlePremiumCollectedEvent } from "@/lib/payment-events";
import { getPolicyStore } from "@/lib/policy-store-factory";
import { normalizeStripeCheckoutCompletedEvent, verifyStripeWebhookSignature } from "@/lib/stripe-webhook";

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

  const normalized = normalizeStripeCheckoutCompletedEvent(JSON.parse(rawBody));
  if (!normalized.ok) {
    return NextResponse.json(
      {
        accepted: false,
        reasonCode: normalized.reasonCode,
        demoMode: true,
        message: normalized.message
      },
      { status: 422 }
    );
  }

  // Activate the policy that create-checkout persisted under this policy_id. The
  // success redirect is not payment truth; this verified webhook event is the
  // only thing that advances the policy to premium_paid.
  const store = getPolicyStore();
  const result = await handlePremiumCollectedEvent(normalized.premiumCollected, store);
  return NextResponse.json(
    {
      ...result,
      demoMode: true,
      normalizedEvent: normalized.premiumCollected
    },
    { status: result.accepted ? 200 : 422 }
  );
}
