import { NextResponse } from "next/server";
import type { CoverageRequest } from "@/lib/types";
import { quotePolicy } from "@/lib/workflow";
import { createLiveStripeCheckoutAdapterFromEnv } from "@/lib/stripe-checkout";
import type { ProductQuoteInput } from "@/lib/coverage-products";
import { quoteCoverageProduct } from "@/lib/coverage-products";

export async function POST(request: Request) {
  const checkoutRequest = (await request.json()) as CoverageRequest | ProductQuoteInput;

  try {
    let productQuote: Awaited<ReturnType<typeof quoteCoverageProduct>> | undefined;
    const policy = isProductQuoteInput(checkoutRequest)
      ? (productQuote = await quoteCoverageProduct(checkoutRequest)).policy
      : quotePolicy(checkoutRequest);
    const payments = createLiveStripeCheckoutAdapterFromEnv();
    const checkout = await payments.createCheckout(
      policy,
      {
        id: `local-${policy.id}`,
        name: policy.customerName
      },
      {
        idempotencyKey: `pio-buy-checkout-${policy.id}-${crypto.randomUUID()}`
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
