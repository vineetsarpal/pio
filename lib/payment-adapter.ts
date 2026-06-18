import type {
  CheckoutSession,
  PaymentCustomer,
  PaymentMode,
  PaymentVerification,
  Policy,
  PayoutResult
} from "./types";

export interface PaymentAdapter {
  readonly mode: PaymentMode;
  createCustomer(name: string): Promise<PaymentCustomer>;
  createCheckout(policy: Policy, customer: PaymentCustomer): Promise<CheckoutSession>;
  verifyPayment(checkout: CheckoutSession): Promise<PaymentVerification>;
  initiatePayout(policy: Policy): Promise<PayoutResult>;
}

export class SimulatedHermesStripeSkillsAdapter implements PaymentAdapter {
  readonly mode = "stripe_test_mode" as const;

  async createCustomer(name: string): Promise<PaymentCustomer> {
    return {
      id: "cus_test_pio_0001",
      name
    };
  }

  async createCheckout(policy: Policy): Promise<CheckoutSession> {
    return {
      id: "cs_test_pio_premium_0001",
      url: "https://checkout.stripe.com/c/pay/cs_test_pio_premium_0001",
      premium: policy.premium,
      mode: this.mode
    };
  }

  async verifyPayment(checkout: CheckoutSession): Promise<PaymentVerification> {
    return {
      paid: true,
      paymentReference: checkout.id,
      paidAt: "2026-06-17T09:02:15-04:00"
    };
  }

  async initiatePayout(policy: Policy): Promise<PayoutResult> {
    if (!policy.stripePaymentReference) {
      return {
        paid: false,
        blockedReason: "Premium payment is not verified."
      };
    }

    if (policy.stripePayoutReference) {
      return {
        paid: false,
        blockedReason: "Policy already has a payout reference."
      };
    }

    return {
      paid: true,
      payoutReference: "po_test_pio_claim_0001",
      paidAt: "2026-06-17T18:10:04-04:00"
    };
  }
}
