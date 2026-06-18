import { describe, expect, it } from "vitest";
import { demoCoverageRequest, demoWeatherEvidence } from "@/lib/demo-fixtures";
import { getAllowedTransitions } from "@/lib/state-machine";
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

describe("policy state machine", () => {
  it("declares the allowed transitions for the happy path", () => {
    expect(getAllowedTransitions("policy_quoted")).toEqual(["premium_paid"]);
    expect(getAllowedTransitions("premium_paid")).toEqual(["policy_issued"]);
    expect(getAllowedTransitions("policy_issued")).toEqual(["monitoring_active"]);
    expect(getAllowedTransitions("trigger_evaluated")).toEqual(["claim_approved", "manual_review", "not_triggered"]);
    expect(getAllowedTransitions("claim_approved")).toEqual(["payout_issued"]);
  });

  it("blocks Gauge from skipping monitoring before trigger data is recorded", () => {
    const quoted = quotePolicy(demoCoverageRequest);
    const paid = markPremiumPaid(quoted, "cs_test_paid", "2026-06-17T09:02:15-04:00");
    const issued = issuePolicy(paid, "2026-06-17T09:02:18-04:00");

    expect(() => recordTriggerData(issued)).toThrow(
      "Invalid policy transition from policy_issued to trigger_data_received"
    );
  });

  it("blocks payout unless deterministic claim approval is the current state", () => {
    const quoted = quotePolicy(demoCoverageRequest);
    const paid = markPremiumPaid(quoted, "cs_test_paid", "2026-06-17T09:02:15-04:00");
    const issued = issuePolicy(paid, "2026-06-17T09:02:18-04:00");
    const triggerData = recordTriggerData(activateMonitoring(issued));
    const decision = evaluateTrigger(triggerData, demoWeatherEvidence);
    const evaluated = recordTriggerEvaluation(triggerData);

    expect(decision.approved).toBe(true);
    expect(() => settleClaim(evaluated, decision, "po_test_skip", "2026-06-17T18:10:04-04:00")).toThrow(
      "after deterministic claim approval"
    );

    const result = settleClaim(
      approveClaim(evaluated),
      decision,
      "po_test_approved",
      "2026-06-17T18:10:04-04:00"
    );
    expect(result.policy.status).toBe("payout_issued");
  });
});
