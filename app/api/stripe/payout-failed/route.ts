import { NextResponse } from "next/server";
import { getDemoPayoutWebhookState } from "@/lib/demo-payout-webhook-store";
import { handlePayoutFailedEvent } from "@/lib/payment-events";
import { normalizeStripePayoutEvent, verifyStripeWebhookSignature } from "@/lib/stripe-webhook";

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

  const normalized = normalizeStripePayoutEvent(JSON.parse(rawBody));
  if (!normalized.ok) {
    return NextResponse.json(
      { accepted: false, reasonCode: normalized.reasonCode, demoMode: true, message: normalized.message },
      { status: 422 }
    );
  }
  if (normalized.type !== "payout.failed") {
    return NextResponse.json(
      {
        accepted: false,
        reasonCode: "unsupported_event_type",
        demoMode: true,
        message: "This endpoint handles payout.failed events."
      },
      { status: 422 }
    );
  }

  const { store } = await getDemoPayoutWebhookState();
  const result = await handlePayoutFailedEvent(normalized.failed, store);
  return NextResponse.json({ ...result, demoMode: true }, { status: result.accepted ? 200 : 422 });
}
