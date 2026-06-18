import type { CheckoutSession, PaymentCustomer, PaymentMode, Policy } from "./types";
import type { PaymentAdapter } from "./payment-adapter";

type LiveStripeCheckoutAdapterConfig = {
  secretKey: string;
  appUrl: string;
};

type CreateCheckoutOptions = {
  idempotencyKey?: string;
};

type StripeCheckoutResponse = {
  id?: string;
  url?: string;
  error?: {
    message?: string;
  };
};

export class LiveStripeCheckoutAdapter implements Pick<PaymentAdapter, "mode" | "createCheckout"> {
  readonly mode: PaymentMode = "stripe_test_mode";
  private readonly secretKey: string;
  private readonly appUrl: string;

  constructor(config: LiveStripeCheckoutAdapterConfig) {
    if (!config.secretKey) {
      throw new Error("STRIPE_SECRET_KEY is required to create live Stripe test-mode checkout sessions.");
    }
    if (!config.secretKey.startsWith("sk_test_")) {
      throw new Error("PIO demo checkout only accepts Stripe test-mode secret keys.");
    }

    this.secretKey = config.secretKey;
    this.appUrl = config.appUrl.replace(/\/$/, "");
  }

  async createCheckout(
    policy: Policy,
    _customer: PaymentCustomer,
    options: CreateCheckoutOptions = {}
  ): Promise<CheckoutSession> {
    const body = new URLSearchParams();
    body.set("mode", "payment");
    body.set("success_url", `${this.appUrl}/buy/success?session_id={CHECKOUT_SESSION_ID}&policy_id=${policy.id}`);
    body.set("cancel_url", `${this.appUrl}/buy?checkout=cancelled&policy_id=${policy.id}`);
    body.set("line_items[0][quantity]", "1");
    body.set("line_items[0][price_data][currency]", policy.premium.currency.toLowerCase());
    body.set("line_items[0][price_data][unit_amount]", String(Math.round(policy.premium.amount * 100)));
    body.set("line_items[0][price_data][product_data][name]", `${policy.eventName} ${checkoutProductLabel(policy)}`);
    body.set(
      "line_items[0][price_data][product_data][description]",
      `Hackathon demo premium for fixed $${policy.payout.amount} ${checkoutTriggerLabel(policy)} workflow. Not real insurance.`
    );
    body.set("metadata[policy_id]", policy.id);
    body.set("metadata[certificate_id]", policy.certificateId);
    body.set("metadata[demo_mode]", "hackathon_not_real_insurance");

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": options.idempotencyKey ?? `pio-checkout-${policy.id}`
      },
      body
    });

    const payload = (await response.json()) as StripeCheckoutResponse;
    if (!response.ok || !payload.id || !payload.url) {
      throw new Error(
        `Stripe Checkout Session creation failed: ${payload.error?.message ?? `HTTP ${response.status}`}`
      );
    }

    return {
      id: payload.id,
      url: payload.url,
      premium: policy.premium,
      mode: this.mode
    };
  }
}

function checkoutProductLabel(policy: Policy): string {
  if (policy.productId === "flight_delay") return "flight delay protection demo";
  return "rain protection demo";
}

function checkoutTriggerLabel(policy: Policy): string {
  if (policy.trigger.variable === "arrival_delay_minutes") return "flight-delay-trigger";
  return "rainfall-trigger";
}

export function createLiveStripeCheckoutAdapterFromEnv(): LiveStripeCheckoutAdapter {
  return new LiveStripeCheckoutAdapter({
    secretKey: process.env.STRIPE_SECRET_KEY ?? "",
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "http://localhost:3000"
  });
}
