import type { CoverageRequest, Policy } from "./types";
import type { PolicyStore } from "./policy-store";
import { workflowEvent } from "./policy-store";
import { quotePolicy } from "./workflow";
import type { OffSessionChargeResult } from "./stripe-payment-intent";

/** The vaulted card + customer an authorized agent is scoped to charge. */
export type AgentChargeScope = {
  agentId: string;
  customerId: string;
  paymentMethodId: string;
};

export interface OffSessionPayments {
  createOffSessionPaymentIntent(input: {
    policy: Policy;
    customerId: string;
    paymentMethodId: string;
    idempotencyKey?: string;
  }): Promise<OffSessionChargeResult>;
}

export type AgentOffSessionPurchaseInput = {
  idempotencyKey: string;
  coverageRequest: CoverageRequest;
};

export type AgentOffSessionPurchaseResponse =
  | {
      accepted: true;
      reasonCode: "off_session_charge_created";
      agentId: string;
      policy: Policy;
      paymentIntentId: string;
      nextAction: "await_payment_intent_webhook";
    }
  | {
      accepted: false;
      reasonCode: string;
      agentId?: string;
      message: string;
    };

/**
 * The headless tracer-bullet purchase: quote a policy, persist the quote, and
 * charge the agent's vaulted card off-session. The policy is NOT advanced here —
 * activation to premium_paid → policy_issued happens only when the verified
 * `payment_intent.succeeded` webhook arrives, exactly as the Checkout path relies
 * on its webhook rather than the success redirect. A declined charge returns a
 * typed reason code and leaves the policy at policy_quoted: fail closed, never
 * issue on a failed payment.
 */
export async function handleAgentOffSessionPurchase(
  input: AgentOffSessionPurchaseInput,
  deps: { store: PolicyStore; payments: OffSessionPayments; seed: AgentChargeScope }
): Promise<AgentOffSessionPurchaseResponse> {
  const { store, payments, seed } = deps;

  const quoted = quotePolicy(input.coverageRequest);
  // quotePolicy emits a fixed demo id; mint a unique identity so persisted
  // policies — and the policy_id in the PaymentIntent metadata — never collide.
  const identity = crypto.randomUUID();
  const policy: Policy = {
    ...quoted,
    id: `pio-pol-${identity}`,
    certificateId: `PIO-CERT-${identity}`
  };

  await store.withTransaction(async (tx) => {
    await tx.savePolicy(policy);
    await tx.appendWorkflowEvent(
      workflowEvent({
        policyId: policy.id,
        at: new Date().toISOString(),
        kind: "policy_quoted",
        actor: "PIO deterministic engine",
        summary: "Deterministic quote persisted ahead of off-session charge.",
        data: { premium: policy.premium, payout: policy.payout, agentId: seed.agentId }
      })
    );
  });

  const charge = await payments.createOffSessionPaymentIntent({
    policy,
    customerId: seed.customerId,
    paymentMethodId: seed.paymentMethodId,
    idempotencyKey: `pio-offsession-${policy.id}-${input.idempotencyKey}`
  });

  if (!charge.ok) {
    return {
      accepted: false,
      reasonCode: charge.reasonCode,
      agentId: seed.agentId,
      message: charge.message
    };
  }

  return {
    accepted: true,
    reasonCode: "off_session_charge_created",
    agentId: seed.agentId,
    policy,
    paymentIntentId: charge.paymentIntent.id,
    nextAction: "await_payment_intent_webhook"
  };
}
