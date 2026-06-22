import type {
  AuditReport,
  AuditSnapshot,
  Policy,
  PolicyLedgerSnapshot,
  PolicyStatus,
  SettlementResult,
  WeatherEvidence
} from "./types";

const terminalAuditStatuses: PolicyStatus[] = ["payout_issued", "not_triggered", "manual_review"];

export function generateAuditReport(
  policy: Policy,
  evidence: WeatherEvidence,
  settlement: SettlementResult,
  sourceEventCount = 0
): AuditReport {
  return generateLivingAuditReport({
    policy,
    evidence,
    settlement,
    generatedAt: "2026-06-17T18:10:07-04:00",
    sourceEventCount
  });
}

export function generateLivingAuditReport({
  policy,
  evidence,
  settlement,
  generatedAt,
  sourceEventCount
}: {
  policy: Policy;
  evidence?: WeatherEvidence;
  settlement?: SettlementResult;
  generatedAt: string;
  sourceEventCount: number;
}): AuditReport {
  const eventWindow = `${policy.trigger.window.start} to ${policy.trigger.window.end}`;
  const reportStatus = terminalAuditStatuses.includes(policy.status) ? "final" : "draft";
  const settlementLabel = settlement
    ? settlement.decision.approved
      ? "approved and paid"
      : settlement.decision.manualReviewRequired
        ? "sent to manual review"
        : "not triggered"
    : "in progress";
  const rainfall = settlement ? `${settlement.decision.rainfallTotalMm.toFixed(1)} mm` : "pending";

  return {
    id: `audit-${policy.id}`,
    status: reportStatus,
    generatedAt,
    finalizedAt: reportStatus === "final" ? generatedAt : undefined,
    sourceEventCount,
    summary: `PIO audit is ${reportStatus} for simulated policy ${policy.id}: workflow ${settlementLabel}; rainfall evidence ${rainfall}; trigger ${policy.trigger.threshold} mm.`,
    facts: [
      `Customer: ${policy.customerName}`,
      `Event: ${policy.eventName}`,
      `Coverage window: ${eventWindow}`,
      `Report status: ${reportStatus}`,
      `Source events: ${sourceEventCount}`,
      `Weather oracle: ${evidence?.source ?? "pending"}`,
      `Oracle snapshot: ${evidence?.metadata.snapshotId ?? "pending"}`,
      `Oracle grade: ${evidence ? (evidence.metadata.settlementGrade ? "settlement-grade" : "advisory-only") : "pending"}`,
      `Missing observations: ${evidence?.metadata.missingObservationCount ?? "pending"}`,
      `Missing-data policy: ${evidence?.metadata.missingDataPolicy ?? "pending"}`,
      `Observations reviewed: ${evidence?.observations.length ?? 0}`,
      ...(policy.pricedBy === "operator_research"
        ? [
            `Pricing: priced via operator research: score ${policy.riskScore}, ${policy.riskCitations?.length ?? 0} sources`,
            ...(policy.riskCitations ?? []).map((c) => `Research source: ${c.url}`)
          ]
        : []),
      `Premium payment: ${policy.stripePaymentReference ?? "missing"}`,
      `Payout reference: ${settlement?.payoutReference ?? "not issued"}`,
      `Settlement status: ${policy.status}`
    ]
  };
}

export function generateAuditTrail({
  policy,
  evidence,
  settlement,
  ledger
}: {
  policy: Policy;
  evidence: WeatherEvidence;
  settlement: SettlementResult;
  ledger: PolicyLedgerSnapshot;
}): AuditReport[] {
  const checkpoints = [
    { kind: "policy_quoted", generatedAt: "2026-06-17T09:01:04-04:00" },
    { kind: "premium_verified", generatedAt: "2026-06-17T09:02:16-04:00" },
    { kind: "trigger_evaluated", generatedAt: "2026-06-17T18:10:02-04:00" },
    { kind: "audit_generated", generatedAt: "2026-06-17T18:10:07-04:00" }
  ] as const;

  return checkpoints
    .map((checkpoint) => {
      const eventIndex = ledger.workflowEvents.findIndex((event) => event.kind === checkpoint.kind);
      if (eventIndex === -1) return undefined;
      const sourceEventCount = eventIndex + 1;
      const isFinal = checkpoint.kind === "audit_generated";
      return generateLivingAuditReport({
        policy: isFinal ? policy : { ...policy, status: ledger.workflowEvents[eventIndex].kind === "trigger_evaluated" ? "trigger_evaluated" : "policy_quoted" },
        evidence: checkpoint.kind === "policy_quoted" || checkpoint.kind === "premium_verified" ? undefined : evidence,
        settlement: isFinal ? settlement : undefined,
        generatedAt: checkpoint.generatedAt,
        sourceEventCount
      });
    })
    .filter((report): report is AuditReport => Boolean(report));
}

export function createFinalAuditSnapshot({
  policyId,
  report,
  createdAt = report.finalizedAt ?? report.generatedAt
}: {
  policyId: string;
  report: AuditReport;
  createdAt?: string;
}): AuditSnapshot {
  if (report.status !== "final") {
    throw new Error("Only final audit reports can be snapshotted.");
  }

  return {
    id: `audit-snapshot-${policyId}-${createdAt}`,
    policyId,
    report: structuredClone(report),
    createdAt,
    sourceEventCount: report.sourceEventCount,
    immutable: true
  };
}
