import { NextResponse } from "next/server";
import type { CoverageRequest, Policy } from "@/lib/types";
import { quotePolicy } from "@/lib/workflow";
import { createLiveStripeCheckoutAdapterFromEnv } from "@/lib/stripe-checkout";
import type { ProductQuoteInput } from "@/lib/coverage-products";
import { quoteCoverageProduct } from "@/lib/coverage-products";
import { getPolicyStore } from "@/lib/policy-store-factory";
import { workflowEvent } from "@/lib/policy-store";
import { checkoutRequestSchema, parseJsonBody } from "@/lib/http-schemas";
import { signPolicyStatusToken } from "@/lib/policy-status-token";

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, checkoutRequestSchema);
  if (!parsed.ok) {
    return NextResponse.json(
      { accepted: false, reasonCode: "invalid_request", demoMode: true, message: parsed.message },
      { status: 400 }
    );
  }
  const checkoutRequest = parsed.data as CoverageRequest | ProductQuoteInput;

  try {
    let productQuote: Awaited<ReturnType<typeof quoteCoverageProduct>> | undefined;
    const quoted = isProductQuoteInput(checkoutRequest)
      ? (productQuote = await quoteCoverageProduct(checkoutRequest)).policy
      : quotePolicy(checkoutRequest);

    // quotePolicy emits a fixed demo id; mint a unique identity so persisted
    // policies — and the policy_id we hand Stripe in checkout metadata — never
    // collide across buyers.
    const identity = crypto.randomUUID();
    const policy: Policy = {
      ...quoted,
      id: `pio-pol-${identity}`,
      certificateId: `PIO-CERT-${identity}`
    };

    // Persist the quote BEFORE creating the Stripe session so the webhook has a
    // policy to activate when checkout.session.completed arrives. (If Stripe
    // creation fails afterwards, the dangling quote is harmless — an unpaid
    // quote that never advances.)
    const store = getPolicyStore();
    await store.withTransaction(async (tx) => {
      await tx.savePolicy(policy);
      await tx.appendWorkflowEvent(
        workflowEvent({
          policyId: policy.id,
          at: new Date().toISOString(),
          kind: "policy_quoted",
          actor: "PIO deterministic engine",
          summary: "Deterministic quote persisted ahead of Stripe checkout.",
          data: { premium: policy.premium, payout: policy.payout, trigger: policy.trigger }
        })
      );
    });

    const payments = createLiveStripeCheckoutAdapterFromEnv();
    const statusToken = signPolicyStatusToken(policy.id, Math.floor(Date.now() / 1000) + 3600);
    const checkout = await payments.createCheckout(
      policy,
      {
        id: `local-${policy.id}`,
        name: policy.customerName
      },
      {
        idempotencyKey: `pio-buy-checkout-${policy.id}`,
        statusToken
      }
    );

    return NextResponse.json({
      accepted: true,
      reasonCode: "checkout_created",
      demoMode: true,
      policy,
      productQuote,
      checkout,
      nextAction: "complete_stripe_checkout"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create checkout.";
    const stripeConfigurationIssue =
      message.includes("STRIPE_SECRET_KEY") || message.includes("test-mode secret keys");

    return NextResponse.json(
      {
        accepted: false,
        reasonCode: stripeConfigurationIssue ? "stripe_not_configured" : "checkout_creation_failed",
        demoMode: true,
        message
      },
      { status: stripeConfigurationIssue ? 503 : 400 }
    );
  }
}

function isProductQuoteInput(input: CoverageRequest | ProductQuoteInput): input is ProductQuoteInput {
  return "productId" in input && (input.productId === "rain_event" || input.productId === "flight_delay");
}
