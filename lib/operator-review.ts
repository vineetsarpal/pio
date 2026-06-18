import type { OperatorReviewItem, PaymentEvent, Policy, PolicyLedgerSnapshot, WorkflowEvent } from "./types";

export function buildOperatorReviewQueue(ledger: PolicyLedgerSnapshot): OperatorReviewItem[] {
  const manualReviews = ledger.policies
    .filter((policy) => policy.status === "manual_review")
    .map((policy) => manualReviewItem(policy, latestWorkflowEvent(ledger, policy.id, "manual_review")));
  const payoutFailures = ledger.paymentEvents
    .filter((event) => event.kind === "payout_failed")
    .map((event) => payoutFailureItem(event, ledger.policies.find((policy) => policy.id === event.policyId)));

  return [...manualReviews, ...payoutFailures].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
  );
}

function manualReviewItem(policy: Policy, event?: WorkflowEvent): OperatorReviewItem {
  return {
    id: `review-${policy.id}-manual-weather`,
    policyId: policy.id,
    createdAt: event?.at ?? policy.settledAt ?? "unknown",
    reason: "manual_weather_review",
    severity: "medium",
    status: "open",
    title: "Review weather evidence",
    summary: event?.summary ?? "Claim requires operator review before final audit.",
    nextAction: "Inspect oracle metadata, decide whether to close without payout or attach approved settlement evidence.",
    sourceEventId: event?.id
  };
}

function payoutFailureItem(event: PaymentEvent, policy?: Policy): OperatorReviewItem {
  return {
    id: `review-${event.policyId}-payout-failed-${event.reference}`,
    policyId: event.policyId,
    createdAt: event.at,
    reason: "payout_failed",
    severity: "high",
    status: "open",
    title: "Resolve failed payout",
    summary: event.failureReason
      ? `Stripe payout failed for ${policy?.customerName ?? event.policyId}: ${event.failureReason}.`
      : `Stripe payout failed for ${policy?.customerName ?? event.policyId}.`,
    nextAction: "Check payout destination and retry through the payment adapter after the failure is resolved.",
    sourceEventId: event.id
  };
}

function latestWorkflowEvent(
  ledger: PolicyLedgerSnapshot,
  policyId: string,
  kind: WorkflowEvent["kind"]
): WorkflowEvent | undefined {
  return ledger.workflowEvents
    .filter((event) => event.policyId === policyId && event.kind === kind)
    .at(-1);
}
