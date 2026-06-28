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
  createCheckout(policy: Policy, customer: PaymentCustomer, options?: CreateCheckoutOptions): Promise<CheckoutSession>;
  verifyPayment(checkout: CheckoutSession): Promise<PaymentVerification>;
  initiatePayout(policy: Policy): Promise<PayoutResult>;
}

export type CreateCheckoutOptions = {
  idempotencyKey?: string;
  statusToken?: string;
};
