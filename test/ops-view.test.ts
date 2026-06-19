import { describe, expect, it } from "vitest";
import { buildPolicyTimeline, findAuditReport, findTriggerDecision, findWeatherEvidence } from "../lib/ops-view";
import { paymentEvent, workflowEvent } from "../lib/policy-store";
import type { PolicyLedgerSnapshot } from "../lib/types";

function ledgerWith(overrides: Partial<PolicyLedgerSnapshot> = {}): PolicyLedgerSnapshot {
  return { policies: [], workflowEvents: [], paymentEvents: [], auditSnapshots: [], ...overrides };
}

describe("buildPolicyTimeline", () => {
  it("merges workflow and payment events in ascending time order", () => {
    const ledger = ledgerWith({
      workflowEvents: [
        workflowEvent({ policyId: "p1", at: "2026-06-17T09:01:03-04:00", kind: "policy_quoted", actor: "PIO deterministic engine", summary: "quoted", data: {} })
      ],
      paymentEvents: [
        paymentEvent({ policyId: "p1", at: "2026-06-17T09:02:15-04:00", kind: "premium_collected", reference: "cs_1", amount: { amount: 25, currency: "USD" }, mode: "stripe_test_mode" })
      ]
    });

    const timeline = buildPolicyTimeline(ledger);
    expect(timeline.map((item) => item.source)).toEqual(["workflow", "payment"]);
    expect(timeline[0].kind).toBe("policy_quoted");
  });
});

describe("optional detail extractors", () => {
  it("returns undefined when the backing events are absent", () => {
    const ledger = ledgerWith();
    expect(findWeatherEvidence(ledger)).toBeUndefined();
    expect(findTriggerDecision(ledger)).toBeUndefined();
    expect(findAuditReport(ledger)).toBeUndefined();
  });

  it("extracts weather, decision, and audit from event data when present", () => {
    const decision = { approved: true, manualReviewRequired: false, rainfallTotalMm: 9, thresholdMm: 5, reason: "ok" };
    const report = { id: "rep-1", status: "final" as const, generatedAt: "2026-06-17T18:11:00-04:00", sourceEventCount: 1, summary: "audit", facts: [] };
    const ledger = ledgerWith({
      workflowEvents: [
        workflowEvent({ policyId: "p1", at: "2026-06-17T18:10:00-04:00", kind: "trigger_data_received", actor: "Weather oracle", summary: "obs", data: { source: "open_meteo", metadata: { snapshotId: "s1" }, observations: [{ observedAt: "x", rainfallMm: 9 }] } }),
        workflowEvent({ policyId: "p1", at: "2026-06-17T18:10:01-04:00", kind: "trigger_evaluated", actor: "PIO deterministic engine", summary: "eval", data: { decision } })
      ],
      auditSnapshots: [
        { id: "a1", policyId: "p1", report, createdAt: "2026-06-17T18:11:00-04:00", sourceEventCount: 1, immutable: true }
      ]
    });

    expect(findWeatherEvidence(ledger)?.observations).toHaveLength(1);
    expect(findTriggerDecision(ledger)?.approved).toBe(true);
    expect(findAuditReport(ledger)?.id).toBe("rep-1");
  });
});
