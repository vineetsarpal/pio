import type { Money, PaymentEvent, Policy, PolicyStatus, WorkflowEvent, LedgerApplyResult } from "./types";
import { paymentEvent, runIdempotent, workflowEvent, type PolicyStore } from "./policy-store";

type PaymentEventInput = Omit<PaymentEvent, "id">;
type WorkflowEventInput = Omit<WorkflowEvent, "id">;

/**
 * Declarative description of one money event's rules. The shared choreography
 * (idempotent replay, single transaction, not-found, append payment + workflow
 * events, optional state advance) lives in `applyLedgerEvent`; everything that
 * varies between events is data here. Outbound `tx` never leaks to the caller.
 *
 * The replay probe is derived from `paymentEvent` — an event is a duplicate
 * when a payment event with the same `(kind, reference)` already exists — so the
 * same builder is the single source of truth for both the probe and the append.
 */
export type LedgerEventSpec = {
  policyId: string;
  /** Allowed policy states for this event; omit to skip the state check (e.g. payout_failed). */
  expectedStates?: PolicyStatus[];
  /** Reconcile the event amount against this policy money; omit to skip (e.g. payout_failed). */
  matchAmount?: "premium" | "payout";
  /** Require a prior payment event (e.g. a payout_requested) before this one is valid. */
  requiresPriorEvent?: { kind: PaymentEvent["kind"]; reference: string };
  /** Reject if the policy already has a completed payout. */
  forbidIfPaidOut?: boolean;
  paymentEvent: (policy: Policy) => PaymentEventInput;
  workflowEvent: (policy: Policy) => WorkflowEventInput;
  /** Advance policy state; omit when the event records money without moving the policy (requested/failed). */
  mutate?: (policy: Policy) => Policy;
};

/**
 * Apply a money event to the Ledger idempotently and atomically. Check order is
 * fixed: not-found → replay → requiresPriorEvent → forbidIfPaidOut →
 * expectedStates → matchAmount → mutate → append.
 */
export async function applyLedgerEvent(store: PolicyStore, spec: LedgerEventSpec): Promise<LedgerApplyResult> {
  return runIdempotent(() =>
    store.withTransaction(async (tx): Promise<LedgerApplyResult> => {
      const policy = await tx.getPolicy(spec.policyId);
      if (!policy) {
        return { accepted: false, reasonCode: "policy_not_found", message: `Policy ${spec.policyId} was not found.` };
      }

      const candidate = spec.paymentEvent(policy);

      // Canonical Stripe idempotency: an Inbound Money Event carries its Event
      // Identity (evt_…). If we have already applied that event, replay it —
      // even if a redelivery arrives with a different business reference.
      if (candidate.eventIdentity) {
        const byIdentity = await tx.findPaymentEventByIdentity(policy.id, candidate.eventIdentity);
        if (byIdentity) {
          return { accepted: true, policy, paymentEvent: byIdentity, idempotentReplay: true };
        }
      }

      const existing = await tx.findPaymentEvent(policy.id, candidate.kind, candidate.reference);
      if (existing) {
        return { accepted: true, policy, paymentEvent: existing, idempotentReplay: true };
      }

      if (spec.requiresPriorEvent) {
        const prior = await tx.findPaymentEvent(
          policy.id,
          spec.requiresPriorEvent.kind,
          spec.requiresPriorEvent.reference
        );
        if (!prior) {
          return {
            accepted: false,
            reasonCode: "payout_not_requested",
            message: `Payout request ${spec.requiresPriorEvent.reference} was not found.`
          };
        }
      }

      if (spec.forbidIfPaidOut && (await tx.hasPayout(policy.id))) {
        return {
          accepted: false,
          reasonCode: "payout_already_completed",
          message: `Policy ${policy.id} already has a completed payout.`
        };
      }

      if (spec.expectedStates && !spec.expectedStates.includes(policy.status)) {
        return {
          accepted: false,
          reasonCode: "invalid_policy_state",
          message: `Event cannot be applied from policy state ${policy.status}.`
        };
      }

      if (spec.matchAmount) {
        const expected: Money = spec.matchAmount === "premium" ? policy.premium : policy.payout;
        const codes =
          spec.matchAmount === "premium"
            ? ({ currency: "premium_currency_mismatch", amount: "premium_amount_mismatch" } as const)
            : ({ currency: "payout_currency_mismatch", amount: "payout_amount_mismatch" } as const);
        if (candidate.amount.currency !== expected.currency) {
          return {
            accepted: false,
            reasonCode: codes.currency,
            message: `${spec.matchAmount} currency ${candidate.amount.currency} does not match ${expected.currency}.`
          };
        }
        if (candidate.amount.amount !== expected.amount) {
          return {
            accepted: false,
            reasonCode: codes.amount,
            message: `${spec.matchAmount} amount ${candidate.amount.amount} does not match ${expected.amount}.`
          };
        }
      }

      const mutated = spec.mutate ? spec.mutate(policy) : policy;
      const payment = paymentEvent(candidate);
      await tx.appendPaymentEvent(payment);
      if (spec.mutate) {
        await tx.savePolicy(mutated);
      }
      await tx.appendWorkflowEvent(workflowEvent(spec.workflowEvent(mutated)));

      return { accepted: true, policy: mutated, paymentEvent: payment, idempotentReplay: false };
    })
  );
}
