import { describe, expect, it } from "vitest";
import { demoCoverageRequest } from "@/lib/demo-fixtures";
import { createFinalAuditSnapshot, generateLivingAuditReport } from "@/lib/audit";
import { demoWeatherEvidence } from "@/lib/demo-fixtures";
import { runGaugeDemoWorkflow } from "@/lib/gauge-tools";
import { InMemoryPolicyStore, paymentEvent } from "@/lib/policy-store";
import { SimulatedHermesStripeSkillsAdapter } from "./fakes";
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

describe("policy store", () => {
  it("records the workflow and payment events that form the audit spine", async () => {
    const store = new InMemoryPolicyStore();
    const run = await runGaugeDemoWorkflow({ store, payments: new SimulatedHermesStripeSkillsAdapter() });
    const snapshot = await store.snapshot();

    expect(run.ledger).toEqual(snapshot);
    expect(snapshot.policies).toHaveLength(1);
    expect(snapshot.workflowEvents.map((event) => event.kind)).toEqual([
      "coverage_requested",
      "policy_quoted",
      "stripe_customer_created",
      "stripe_checkout_created",
      "premium_verified",
      "policy_issued",
      "monitoring_started",
      "trigger_data_received",
      "trigger_evaluated",
      "claim_approved",
      "payout_requested",
      "payout_issued",
      "audit_generated"
    ]);
    expect(snapshot.paymentEvents.map((event) => event.kind)).toEqual([
      "premium_collected",
      "payout_requested",
      "payout_issued"
    ]);
    expect(snapshot.auditSnapshots).toHaveLength(1);
    expect(snapshot.auditSnapshots[0]).toMatchObject({
      policyId: run.policy.id,
      immutable: true,
      sourceEventCount: snapshot.workflowEvents.length
    });
  });

  it("blocks duplicate payout events at the source-of-truth boundary", async () => {
    const store = new InMemoryPolicyStore();
    const policy = markPremiumPaid(
      quotePolicy(demoCoverageRequest),
      "cs_test_paid",
      "2026-06-17T09:02:15-04:00"
    );
    const payout = paymentEvent({
      policyId: policy.id,
      at: "2026-06-17T18:10:04-04:00",
      kind: "payout_issued",
      reference: "po_test_once",
      amount: policy.payout,
      mode: "stripe_test_mode"
    });

    await store.appendPaymentEvent(payout);
    await expect(
      store.appendPaymentEvent({
        ...payout,
        id: "pay-pio-pol-2026-0001-payout_issued-po_test_twice",
        reference: "po_test_twice"
      })
    ).rejects.toThrow("duplicate payout");
  });

  it("blocks duplicate final audit snapshots", async () => {
    const store = new InMemoryPolicyStore();
    const paid = markPremiumPaid(
      quotePolicy(demoCoverageRequest),
      "cs_test_paid",
      "2026-06-17T09:02:15-04:00"
    );
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
      sourceEventCount: 13
    });
    const snapshot = createFinalAuditSnapshot({ policyId: settlement.policy.id, report });

    await store.appendAuditSnapshot(snapshot);
    await expect(store.appendAuditSnapshot(snapshot)).rejects.toThrow("duplicate audit snapshot");
  });
});
