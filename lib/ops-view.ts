import type {
  AuditReport,
  PolicyLedgerSnapshot,
  TriggerDecision,
  WeatherEvidence,
  WeatherObservation
} from "./types";

export type TimelineItem = {
  key: string;
  at: string;
  source: "workflow" | "payment";
  kind: string;
  actor?: string;
  summary: string;
};

export function buildPolicyTimeline(ledger: PolicyLedgerSnapshot): TimelineItem[] {
  const workflow: TimelineItem[] = ledger.workflowEvents.map((event) => ({
    key: `wf-${event.id}`,
    at: event.at,
    source: "workflow",
    kind: event.kind,
    actor: event.actor,
    summary: event.summary
  }));
  const payment: TimelineItem[] = ledger.paymentEvents.map((event) => ({
    key: `pay-${event.id}`,
    at: event.at,
    source: "payment",
    kind: event.kind,
    summary: `${event.kind.replaceAll("_", " ")} · ${event.reference}`
  }));
  return [...workflow, ...payment].sort(
    (left, right) => new Date(left.at).getTime() - new Date(right.at).getTime()
  );
}

export function findWeatherEvidence(ledger: PolicyLedgerSnapshot): WeatherEvidence | undefined {
  const event = ledger.workflowEvents.find((candidate) => candidate.kind === "trigger_data_received");
  if (!event) return undefined;
  const data = event.data as { source?: unknown; metadata?: unknown; observations?: unknown };
  if (!Array.isArray(data.observations)) return undefined;
  return {
    source: data.source as WeatherEvidence["source"],
    metadata: data.metadata as WeatherEvidence["metadata"],
    observations: data.observations as WeatherObservation[]
  };
}

export function findTriggerDecision(ledger: PolicyLedgerSnapshot): TriggerDecision | undefined {
  const event = ledger.workflowEvents.find((candidate) => candidate.kind === "trigger_evaluated");
  const decision = (event?.data as { decision?: unknown } | undefined)?.decision;
  return decision ? (decision as TriggerDecision) : undefined;
}

export function findAuditReport(ledger: PolicyLedgerSnapshot): AuditReport | undefined {
  return ledger.auditSnapshots[0]?.report;
}
