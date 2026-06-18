import { NextResponse } from "next/server";
import { demoCoverageRequest } from "@/lib/demo-fixtures";
import { handlePremiumCollectedEvent } from "@/lib/payment-events";
import { InMemoryPolicyStore, workflowEvent } from "@/lib/policy-store";
import { normalizeStripeCheckoutCompletedEvent, verifyStripeWebhookSignature } from "@/lib/stripe-webhook";
import { quotePolicy } from "@/lib/workflow";

const globalStripeWebhookState = globalThis as typeof globalThis & {
  pioStripeWebhookStore?: InMemoryPolicyStore;
  pioStripeWebhookSeed?: Promise<void>;
};

const store = (globalStripeWebhookState.pioStripeWebhookStore ??= new InMemoryPolicyStore());
const seedStore =
  globalStripeWebhookState.pioStripeWebhookSeed ??=
  (async () => {
    const demoPolicy = quotePolicy(demoCoverageRequest);
    await store.savePolicy(demoPolicy);
    await store.appendWorkflowEvent(
      workflowEvent({
        policyId: demoPolicy.id,
        at: "2026-06-17T09:01:03-04:00",
        kind: "policy_quoted",
        actor: "PIO deterministic engine",
        summary: "Demo quote seeded for Stripe checkout.session.completed webhook.",
        data: { premium: demoPolicy.premium, payout: demoPolicy.payout, trigger: demoPolicy.trigger }
      })
    );
  })();

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

  await seedStore;
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
