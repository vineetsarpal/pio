import type { PolicyStore } from "./policy-store";
import type {
  PayoutCompletedEvent,
  PayoutEventResult,
  PayoutFailedEvent,
  PayoutRequestedEvent,
  PremiumCollectedEvent,
  PremiumCollectedResult,
  TriggerDecision
} from "./types";
import { paymentEvent, runIdempotent, workflowEvent } from "./policy-store";
import { markPremiumPaid, settleClaim } from "./workflow";

export async function handlePremiumCollectedEvent(
  event: PremiumCollectedEvent,
  store: PolicyStore
): Promise<PremiumCollectedResult> {
  return runIdempotent(() =>
    store.withTransaction(async (tx): Promise<PremiumCollectedResult> => {
      const policy = await tx.getPolicy(event.policyId);
      if (!policy) {
        return {
          accepted: false,
          reasonCode: "policy_not_found",
          message: `Policy ${event.policyId} was not found for premium collection event.`
        };
      }

      const existing = await tx.findPaymentEvent(policy.id, "premium_collected", event.checkoutId);
      if (existing) {
        return {
          accepted: true,
          policy,
          paymentEvent: existing,
          idempotentReplay: true
        };
      }

      if (policy.status !== "policy_quoted") {
        return {
          accepted: false,
          reasonCode: "invalid_policy_state",
          message: `Premium collection cannot activate policy from ${policy.status}.`
        };
      }

      if (event.amount.currency !== policy.premium.currency) {
        return {
          accepted: false,
          reasonCode: "premium_currency_mismatch",
          message: `Premium currency ${event.amount.currency} does not match policy premium currency ${policy.premium.currency}.`
        };
      }

      if (event.amount.amount !== policy.premium.amount) {
        return {
          accepted: false,
          reasonCode: "premium_amount_mismatch",
          message: `Collected premium ${event.amount.amount} does not match quoted premium ${policy.premium.amount}.`
        };
      }

      const paidPolicy = markPremiumPaid(policy, event.checkoutId, event.paidAt);
      const collected = paymentEvent({
        policyId: paidPolicy.id,
        at: event.paidAt,
        kind: "premium_collected",
        reference: event.checkoutId,
        amount: event.amount,
        mode: event.mode,
        providerEventId: event.providerEventId
      });

      await tx.appendPaymentEvent(collected);
      await tx.savePolicy(paidPolicy);
      await tx.appendWorkflowEvent(
        workflowEvent({
          policyId: paidPolicy.id,
          at: event.paidAt,
          kind: "premium_verified",
          actor: "Stripe Skill",
          summary: "Premium collection event activated the quoted policy.",
          data: {
            checkoutId: event.checkoutId,
            providerEventId: event.providerEventId
          }
        })
      );

      return {
        accepted: true,
        policy: paidPolicy,
        paymentEvent: collected,
        idempotentReplay: false
      };
    })
  );
}

export async function handlePayoutRequestedEvent(
  event: PayoutRequestedEvent,
  store: PolicyStore
): Promise<PayoutEventResult> {
  return runIdempotent(() =>
    store.withTransaction(async (tx): Promise<PayoutEventResult> => {
      const policy = await tx.getPolicy(event.policyId);
      if (!policy) {
        return {
          accepted: false,
          reasonCode: "policy_not_found",
          message: `Policy ${event.policyId} was not found for payout request.`
        };
      }

      const existing = await tx.findPaymentEvent(policy.id, "payout_requested", event.requestId);
      if (existing) {
        return {
          accepted: true,
          policy,
          paymentEvent: existing,
          idempotentReplay: true
        };
      }

      if (policy.status !== "claim_approved") {
        return {
          accepted: false,
          reasonCode: "invalid_policy_state",
          message: `Payout request requires claim_approved state, not ${policy.status}.`
        };
      }

      if (event.amount.currency !== policy.payout.currency) {
        return {
          accepted: false,
          reasonCode: "payout_currency_mismatch",
          message: `Payout currency ${event.amount.currency} does not match policy payout currency ${policy.payout.currency}.`
        };
      }

      if (event.amount.amount !== policy.payout.amount) {
        return {
          accepted: false,
          reasonCode: "payout_amount_mismatch",
          message: `Requested payout ${event.amount.amount} does not match fixed payout ${policy.payout.amount}.`
        };
      }

      const requested = paymentEvent({
        policyId: policy.id,
        at: event.requestedAt,
        kind: "payout_requested",
        reference: event.requestId,
        amount: event.amount,
        mode: event.mode,
        providerEventId: event.requestId
      });

      await tx.appendPaymentEvent(requested);
      await tx.appendWorkflowEvent(
        workflowEvent({
          policyId: policy.id,
          at: event.requestedAt,
          kind: "payout_requested",
          actor: "PIO deterministic engine",
          summary: "Deterministic settlement requested a fixed payout after claim approval.",
          data: { requestId: event.requestId, amount: event.amount }
        })
      );

      return {
        accepted: true,
        policy,
        paymentEvent: requested,
        idempotentReplay: false
      };
    })
  );
}

export async function handlePayoutCompletedEvent(
  event: PayoutCompletedEvent,
  store: PolicyStore,
  decision: TriggerDecision
): Promise<PayoutEventResult> {
  return runIdempotent(() =>
    store.withTransaction(async (tx): Promise<PayoutEventResult> => {
      const policy = await tx.getPolicy(event.policyId);
      if (!policy) {
        return {
          accepted: false,
          reasonCode: "policy_not_found",
          message: `Policy ${event.policyId} was not found for payout completion.`
        };
      }

      const existing = await tx.findPaymentEvent(policy.id, "payout_issued", event.payoutReference);
      if (existing) {
        return {
          accepted: true,
          policy,
          paymentEvent: existing,
          idempotentReplay: true
        };
      }

      const request = await tx.findPaymentEvent(policy.id, "payout_requested", event.requestId);
      if (!request) {
        return {
          accepted: false,
          reasonCode: "payout_not_requested",
          message: `Payout request ${event.requestId} was not found.`
        };
      }

      if (await tx.hasPayout(policy.id)) {
        return {
          accepted: false,
          reasonCode: "payout_already_completed",
          message: `Policy ${policy.id} already has a completed payout.`
        };
      }

      if (policy.status !== "claim_approved") {
        return {
          accepted: false,
          reasonCode: "invalid_policy_state",
          message: `Payout completion requires claim_approved state, not ${policy.status}.`
        };
      }

      if (event.amount.currency !== policy.payout.currency) {
        return {
          accepted: false,
          reasonCode: "payout_currency_mismatch",
          message: `Payout currency ${event.amount.currency} does not match policy payout currency ${policy.payout.currency}.`
        };
      }

      if (event.amount.amount !== policy.payout.amount) {
        return {
          accepted: false,
          reasonCode: "payout_amount_mismatch",
          message: `Completed payout ${event.amount.amount} does not match fixed payout ${policy.payout.amount}.`
        };
      }

      const settlement = settleClaim(policy, decision, event.payoutReference, event.paidAt);
      const issued = paymentEvent({
        policyId: settlement.policy.id,
        at: event.paidAt,
        kind: "payout_issued",
        reference: event.payoutReference,
        amount: event.amount,
        mode: event.mode,
        providerEventId: event.providerEventId
      });

      await tx.appendPaymentEvent(issued);
      await tx.savePolicy(settlement.policy);
      await tx.appendWorkflowEvent(
        workflowEvent({
          policyId: settlement.policy.id,
          at: event.paidAt,
          kind: "payout_issued",
          actor: "Stripe Skill",
          summary: "Stripe Skill completed the fixed payout after deterministic approval.",
          data: { requestId: event.requestId, payoutReference: event.payoutReference }
        })
      );

      return {
        accepted: true,
        policy: settlement.policy,
        paymentEvent: issued,
        idempotentReplay: false
      };
    })
  );
}

export async function handlePayoutFailedEvent(
  event: PayoutFailedEvent,
  store: PolicyStore
): Promise<PayoutEventResult> {
  return runIdempotent(() =>
    store.withTransaction(async (tx): Promise<PayoutEventResult> => {
      const policy = await tx.getPolicy(event.policyId);
      if (!policy) {
        return {
          accepted: false,
          reasonCode: "policy_not_found",
          message: `Policy ${event.policyId} was not found for payout failure.`
        };
      }

      const existing = await tx.findPaymentEvent(policy.id, "payout_failed", event.providerEventId);
      if (existing) {
        return {
          accepted: true,
          policy,
          paymentEvent: existing,
          idempotentReplay: true
        };
      }

      const request = await tx.findPaymentEvent(policy.id, "payout_requested", event.requestId);
      if (!request) {
        return {
          accepted: false,
          reasonCode: "payout_not_requested",
          message: `Payout request ${event.requestId} was not found.`
        };
      }

      if (await tx.hasPayout(policy.id)) {
        return {
          accepted: false,
          reasonCode: "payout_already_completed",
          message: `Policy ${policy.id} already has a completed payout.`
        };
      }

      const failed = paymentEvent({
        policyId: policy.id,
        at: event.failedAt,
        kind: "payout_failed",
        reference: event.providerEventId,
        amount: event.amount,
        mode: event.mode,
        providerEventId: event.providerEventId,
        failureReason: event.failureReason
      });

      await tx.appendPaymentEvent(failed);
      await tx.appendWorkflowEvent(
        workflowEvent({
          policyId: policy.id,
          at: event.failedAt,
          kind: "payout_failed",
          actor: "Stripe Skill",
          summary: "Stripe Skill reported payout failure; claim approval remains unchanged.",
          data: { requestId: event.requestId, failureReason: event.failureReason }
        })
      );

      return {
        accepted: true,
        policy,
        paymentEvent: failed,
        idempotentReplay: false
      };
    })
  );
}
