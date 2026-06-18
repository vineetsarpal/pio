import type {
  LedgerConsistencyReport,
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

export function validateLedgerConsistency(ledger: PolicyLedgerSnapshot): LedgerConsistencyReport {
  const checks = ledger.policies.map((policy) => {
    const projection = projectPolicyStatusFromEvents(policy.id, ledger.workflowEvents);
    const consistent = policy.status === projection.status;

    return {
      policyId: policy.id,
      currentStatus: policy.status,
      projectedStatus: projection.status,
      sourceEventId: projection.sourceEventId,
      consistent,
      message: consistent
        ? `Current policy row ${policy.status} is backed by the latest status-changing workflow event.`
        : `Current policy row ${policy.status} does not match projected ledger status ${projection.status ?? "missing"}.`
    };
  });

  return {
    consistent: checks.every((check) => check.consistent),
    checks
  };
}
