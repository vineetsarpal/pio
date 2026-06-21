import type { PolicyStore } from "./policy-store";
import type {
  LedgerApplyResult,
  PayoutCompletedEvent,
  PayoutFailedEvent,
  PayoutRequestedEvent,
  PolicyIssuanceResult,
  PremiumCollectedEvent,
  TriggerDecision
} from "./types";
import { runIdempotent, workflowEvent } from "./policy-store";
import { applyLedgerEvent } from "./ledger-apply";
import { issuePolicy, markPremiumPaid, settleClaim } from "./workflow";

export function handlePremiumCollectedEvent(
  event: PremiumCollectedEvent,
  store: PolicyStore
): Promise<LedgerApplyResult> {
  return applyLedgerEvent(store, {
    policyId: event.policyId,
    expectedStates: ["policy_quoted"],
    matchAmount: "premium",
    paymentEvent: (policy) => ({
      policyId: policy.id,
      at: event.paidAt,
      kind: "premium_collected",
      reference: event.checkoutId,
      amount: event.amount,
      mode: event.mode,
      providerEventId: event.providerEventId,
      eventIdentity: event.providerEventId
    }),
    mutate: (policy) => markPremiumPaid(policy, event.checkoutId, event.paidAt),
    workflowEvent: (policy) => ({
      policyId: policy.id,
      at: event.paidAt,
      kind: "premium_verified",
      actor: "Stripe Skill",
      summary: "Premium collection event activated the quoted policy.",
      data: {
        checkoutId: event.checkoutId,
        providerEventId: event.providerEventId
      }
    })
  });
}

/**
 * Advance a premium-paid policy to `policy_issued`. This is the issuance step
 * the headless off-session purchase path runs after `premium_collected`; it does
 * not touch the deterministic money core. It is idempotent: a policy already at
 * `policy_issued` (or beyond) replays its current state rather than re-issuing,
 * so a duplicate webhook can never double-issue.
 *
 * Kept outside `applyLedgerEvent` on purpose: issuance writes no payment event
 * and keys its idempotent replay on `policy.issuedAt`, not on a payment-event
 * probe.
 */
export async function handlePolicyIssuanceEvent(
  event: { policyId: string; issuedAt: string },
  store: PolicyStore
): Promise<PolicyIssuanceResult> {
  return runIdempotent(() =>
    store.withTransaction(async (tx): Promise<PolicyIssuanceResult> => {
      const policy = await tx.getPolicy(event.policyId);
      if (!policy) {
        return {
          accepted: false,
          reasonCode: "policy_not_found",
          message: `Policy ${event.policyId} was not found for issuance.`
        };
      }

      if (policy.status !== "premium_paid") {
        if (policy.issuedAt) {
          return { accepted: true, policy, idempotentReplay: true };
        }
        return {
          accepted: false,
          reasonCode: "invalid_policy_state",
          message: `Policy issuance requires premium_paid state, not ${policy.status}.`
        };
      }

      const issued = issuePolicy(policy, event.issuedAt);
      await tx.savePolicy(issued);
      await tx.appendWorkflowEvent(
        workflowEvent({
          policyId: issued.id,
          at: event.issuedAt,
          kind: "policy_issued",
          actor: "PIO deterministic engine",
          summary: "Certificate activated after premium payment was verified.",
          data: { certificateId: issued.certificateId, paymentReference: issued.stripePaymentReference }
        })
      );

      return { accepted: true, policy: issued, idempotentReplay: false };
    })
  );
}

export function handlePayoutRequestedEvent(
  event: PayoutRequestedEvent,
  store: PolicyStore
): Promise<LedgerApplyResult> {
  return applyLedgerEvent(store, {
    policyId: event.policyId,
    expectedStates: ["claim_approved"],
    matchAmount: "payout",
    paymentEvent: (policy) => ({
      policyId: policy.id,
      at: event.requestedAt,
      kind: "payout_requested",
      reference: event.requestId,
      amount: event.amount,
      mode: event.mode,
      providerEventId: event.requestId
    }),
    workflowEvent: (policy) => ({
      policyId: policy.id,
      at: event.requestedAt,
      kind: "payout_requested",
      actor: "PIO deterministic engine",
      summary: "Deterministic settlement requested a fixed payout after claim approval.",
      data: { requestId: event.requestId, amount: event.amount }
    })
  });
}

export function handlePayoutCompletedEvent(
  event: PayoutCompletedEvent,
  store: PolicyStore,
  decision: TriggerDecision
): Promise<LedgerApplyResult> {
  return applyLedgerEvent(store, {
    policyId: event.policyId,
    expectedStates: ["claim_approved"],
    matchAmount: "payout",
    requiresPriorEvent: { kind: "payout_requested", reference: event.requestId },
    forbidIfPaidOut: true,
    paymentEvent: (policy) => ({
      policyId: policy.id,
      at: event.paidAt,
      kind: "payout_issued",
      reference: event.payoutReference,
      amount: event.amount,
      mode: event.mode,
      providerEventId: event.providerEventId,
      eventIdentity: event.providerEventId
    }),
    mutate: (policy) => settleClaim(policy, decision, event.payoutReference, event.paidAt).policy,
    workflowEvent: (policy) => ({
      policyId: policy.id,
      at: event.paidAt,
      kind: "payout_issued",
      actor: "Stripe Skill",
      summary: "Stripe Skill completed the fixed payout after deterministic approval.",
      data: { requestId: event.requestId, payoutReference: event.payoutReference }
    })
  });
}

export function handlePayoutFailedEvent(
  event: PayoutFailedEvent,
  store: PolicyStore
): Promise<LedgerApplyResult> {
  return applyLedgerEvent(store, {
    policyId: event.policyId,
    requiresPriorEvent: { kind: "payout_requested", reference: event.requestId },
    forbidIfPaidOut: true,
    paymentEvent: (policy) => ({
      policyId: policy.id,
      at: event.failedAt,
      kind: "payout_failed",
      reference: event.providerEventId,
      amount: event.amount,
      mode: event.mode,
      providerEventId: event.providerEventId,
      eventIdentity: event.providerEventId,
      failureReason: event.failureReason
    }),
    workflowEvent: (policy) => ({
      policyId: policy.id,
      at: event.failedAt,
      kind: "payout_failed",
      actor: "Stripe Skill",
      summary: "Stripe Skill reported payout failure; claim approval remains unchanged.",
      data: { requestId: event.requestId, failureReason: event.failureReason }
    })
  });
}
