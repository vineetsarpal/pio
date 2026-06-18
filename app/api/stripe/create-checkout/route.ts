import { NextResponse } from "next/server";
import type { CoverageRequest } from "@/lib/types";
import { quotePolicy } from "@/lib/workflow";
import { createLiveStripeCheckoutAdapterFromEnv } from "@/lib/stripe-checkout";

export async function POST(request: Request) {
  const coverageRequest = (await request.json()) as CoverageRequest;

  try {
    const policy = quotePolicy(coverageRequest);
    const payments = createLiveStripeCheckoutAdapterFromEnv();
    const checkout = await payments.createCheckout(policy, {
      id: `local-${policy.id}`,
      name: policy.customerName
    });

    return NextResponse.json({
      accepted: true,
      reasonCode: "checkout_created",
      demoMode: true,
      policy,
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
