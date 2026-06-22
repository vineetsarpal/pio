import type {
  LedgerConsistencyReport,
  Policy,
  PolicyLedgerSnapshot,
  PolicyStatus,
  WorkflowEvent
} from "./types";

const statusByEventKind: Partial<Record<WorkflowEvent["kind"], PolicyStatus>> = {
  coverage_requested: "quote_requested",
  policy_quoted: "policy_quoted",
  premium_verified: "premium_paid",
  policy_issued: "policy_issued",
  monitoring_started: "monitoring_active",
  trigger_data_received: "trigger_data_received",
  trigger_evaluated: "trigger_evaluated",
  claim_approved: "claim_approved",
  manual_review: "manual_review",
  claim_not_triggered: "not_triggered",
  payout_issued: "payout_issued"
};

export function projectPolicyStatusFromEvents(
  policyId: string,
  workflowEvents: WorkflowEvent[]
): { status?: PolicyStatus; sourceEventId?: string } {
  return workflowEvents
    .filter((event) => event.policyId === policyId)
    .reduce<{ status?: PolicyStatus; sourceEventId?: string }>((projection, event) => {
      const status = statusByEventKind[event.kind];
      if (!status) return projection;

      return {
        status,
        sourceEventId: event.id
      };
    }, {});
}

export function assertDynamicPricingEvidence(policy: Policy): string | undefined {
  if (policy.pricingMode !== "dynamic") return undefined;
  if (policy.pricedBy === "deterministic_fallback") return undefined;
  if (policy.pricedBy === "operator_research" && (policy.riskCitations?.length ?? 0) > 0) return undefined;
  return `Dynamic policy ${policy.id} has no pricing evidence: carries neither operator-research citations nor a recorded deterministic fallback.`;
}

export function validateLedgerConsistency(ledger: PolicyLedgerSnapshot): LedgerConsistencyReport {
  const checks = ledger.policies.map((policy) => {
    const projection = projectPolicyStatusFromEvents(policy.id, ledger.workflowEvents);
    const statusConsistent = policy.status === projection.status;
    const dynamicPricingMessage = assertDynamicPricingEvidence(policy);
    const consistent = statusConsistent && !dynamicPricingMessage;

    const message = !statusConsistent
      ? `Current policy row ${policy.status} does not match projected ledger status ${projection.status ?? "missing"}.`
      : dynamicPricingMessage
        ? dynamicPricingMessage
        : `Current policy row ${policy.status} is backed by the latest status-changing workflow event.`;

    return {
      policyId: policy.id,
      currentStatus: policy.status,
      projectedStatus: projection.status,
      sourceEventId: projection.sourceEventId,
      consistent,
      message
    };
  });

  return {
    consistent: checks.every((check) => check.consistent),
    checks
  };
}
