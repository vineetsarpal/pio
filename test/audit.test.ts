import { describe, expect, it } from "vitest";
import { createFinalAuditSnapshot, generateAuditTrail, generateLivingAuditReport } from "@/lib/audit";
import { demoCoverageRequest, demoWeatherEvidence } from "@/lib/demo-fixtures";
import { InMemoryPolicyStore, workflowEvent } from "@/lib/policy-store";
import {
  activateMonitoring,
  approveClaim,
  evaluateTrigger,
  issuePolicy,
  markPremiumPaid,
  quotePolicy,
  recordTriggerData,
  recordTriggerEvaluation,
  settleClaim
} from "@/lib/workflow";

describe("audit reports", () => {
  it("marks in-progress audit reports as draft", () => {
    const policy = quotePolicy(demoCoverageRequest);
    const report = generateLivingAuditReport({
      policy,
      generatedAt: "2026-06-17T09:01:04-04:00",
      sourceEventCount: 2
    });

    expect(report.status).toBe("draft");
    expect(report.finalizedAt).toBeUndefined();
    expect(report.facts).toContain("Report status: draft");
  });

  it("marks terminal audit reports as final", () => {
    const quoted = quotePolicy(demoCoverageRequest);
    const paid = markPremiumPaid(quoted, "cs_test_paid", "2026-06-17T09:02:15-04:00");
    const issued = issuePolicy(paid, "2026-06-17T09:02:18-04:00");
    const triggerData = recordTriggerData(activateMonitoring(issued));
    const decision = evaluateTrigger(triggerData, demoWeatherEvidence);
    const settlement = settleClaim(
      approveClaim(recordTriggerEvaluation(triggerData)),
      decision,
      "po_test_paid",
      "2026-06-17T18:10:04-04:00"
    );

    const report = generateLivingAuditReport({
      policy: settlement.policy,
      evidence: demoWeatherEvidence,
      settlement,
      generatedAt: "2026-06-17T18:10:07-04:00",
      sourceEventCount: 12
    });

    expect(report.status).toBe("final");
    expect(report.finalizedAt).toBe("2026-06-17T18:10:07-04:00");
    expect(report.facts).toContain("Report status: final");
  });

  it("creates immutable snapshots only for final audit reports", () => {
    const policy = quotePolicy(demoCoverageRequest);
    const draft = generateLivingAuditReport({
      policy,
      generatedAt: "2026-06-17T09:01:04-04:00",
      sourceEventCount: 2
    });

    expect(() =>
      createFinalAuditSnapshot({
        policyId: policy.id,
        report: draft
      })
    ).toThrow("Only final audit reports");

    const paid = markPremiumPaid(policy, "cs_test_paid", "2026-06-17T09:02:15-04:00");
    const issued = issuePolicy(paid, "2026-06-17T09:02:18-04:00");
    const triggerData = recordTriggerData(activateMonitoring(issued));
    const decision = evaluateTrigger(triggerData, demoWeatherEvidence);
    const settlement = settleClaim(
      approveClaim(recordTriggerEvaluation(triggerData)),
      decision,
      "po_test_paid",
      "2026-06-17T18:10:04-04:00"
    );
    const final = generateLivingAuditReport({
      policy: settlement.policy,
      evidence: demoWeatherEvidence,
      settlement,
      generatedAt: "2026-06-17T18:10:07-04:00",
      sourceEventCount: 13
    });

    const snapshot = createFinalAuditSnapshot({ policyId: settlement.policy.id, report: final });

    expect(snapshot).toMatchObject({
      id: "audit-snapshot-pio-pol-2026-0001-2026-06-17T18:10:07-04:00",
      policyId: settlement.policy.id,
      immutable: true,
      sourceEventCount: 13
    });
    expect(snapshot.report.status).toBe("final");
  });

  it("surfaces operator research provenance in facts when pricedBy is operator_research", () => {
    const policy = quotePolicy(demoCoverageRequest);
    const researchPolicy = {
      ...policy,
      pricingMode: "dynamic" as const,
      pricedBy: "operator_research" as const,
      riskScore: 0.72,
      riskCitations: [{ url: "https://example.com/source", title: "Source", snippet: "s", retrievedAt: "2026-06-22" }]
    };
    const report = generateLivingAuditReport({
      policy: researchPolicy,
      generatedAt: "2026-06-22T12:00:00Z",
      sourceEventCount: 1
    });

    expect(report.facts.some((f) => f.includes("operator research"))).toBe(true);
    expect(report.facts.some((f) => f.includes("https://example.com/source"))).toBe(true);
  });

  it("builds a living audit trail from ledger checkpoints", async () => {
    const store = new InMemoryPolicyStore();
    const quoted = quotePolicy(demoCoverageRequest);
    const paid = markPremiumPaid(quoted, "cs_test_paid", "2026-06-17T09:02:15-04:00");
    const issued = issuePolicy(paid, "2026-06-17T09:02:18-04:00");
    const triggerData = recordTriggerData(activateMonitoring(issued));
    const decision = evaluateTrigger(triggerData, demoWeatherEvidence);
    const settlement = settleClaim(
      approveClaim(recordTriggerEvaluation(triggerData)),
      decision,
      "po_test_paid",
      "2026-06-17T18:10:04-04:00"
    );
    for (const kind of ["policy_quoted", "premium_verified", "trigger_evaluated", "audit_generated"] as const) {
      await store.appendWorkflowEvent(
        workflowEvent({
          policyId: settlement.policy.id,
          at: "2026-06-17T18:10:07-04:00",
          kind,
          actor: "PIO deterministic engine",
          summary: kind,
          data: {}
        })
      );
    }

    const ledger = await store.snapshot();
    const trail = generateAuditTrail({
      policy: settlement.policy,
      evidence: demoWeatherEvidence,
      settlement,
      ledger
    });

    expect(trail.map((report) => report.status)).toEqual(["draft", "draft", "draft", "final"]);
  });
});
