import type { PaymentAdapter } from "@/lib/payment-adapter";
import type { CheckoutSession, PaymentCustomer, PaymentVerification, Policy, PayoutResult } from "@/lib/types";

/**
 * Test double for the Stripe Skills payment boundary. It returns canned
 * customer/checkout/verification/payout objects so the deterministic workflow
 * and agent-coverage logic can be exercised end-to-end without any external
 * service. Production code never injects this — runtime routes inject the live
 * Stripe adapters and rely on webhooks for verification and payout truth.
 */
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
