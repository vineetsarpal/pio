import { describe, expect, it } from "vitest";
import { runGaugeDemoWorkflow } from "@/lib/gauge-tools";
import {
  projectPolicyStatusFromEvents,
  validateLedgerConsistency
} from "@/lib/ledger-consistency";

describe("ledger consistency", () => {
  it("proves the current policy row is backed by status-changing workflow events", async () => {
    const run = await runGaugeDemoWorkflow();

    expect(run.ledgerConsistency.consistent).toBe(true);
    expect(run.ledgerConsistency.checks[0]).toMatchObject({
      policyId: run.policy.id,
      currentStatus: "payout_issued",
      projectedStatus: "payout_issued",
      consistent: true
    });
  });

  it("ignores audit_generated when projecting operational policy status", async () => {
    const run = await runGaugeDemoWorkflow();
    const projection = projectPolicyStatusFromEvents(run.policy.id, run.ledger.workflowEvents);

    expect(projection.status).toBe("payout_issued");
    expect(projection.sourceEventId).toContain("payout_issued");
  });

  it("detects drift between the current row and the ledger projection", async () => {
    const run = await runGaugeDemoWorkflow();
    const drifted = {
      ...run.ledger,
      policies: [
        {
          ...run.policy,
          status: "claim_approved" as const
        }
      ]
    };

    const report = validateLedgerConsistency(drifted);

    expect(report.consistent).toBe(false);
    expect(report.checks[0]).toMatchObject({
      currentStatus: "claim_approved",
      projectedStatus: "payout_issued",
      consistent: false
    });
    expect(report.checks[0].message).toContain("does not match");
  });
});
