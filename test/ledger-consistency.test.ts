import { describe, expect, it } from "vitest";
import { runGaugeDemoWorkflow } from "@/lib/gauge-tools";
import {
  assertDynamicPricingEvidence,
  projectPolicyStatusFromEvents,
  validateLedgerConsistency
} from "@/lib/ledger-consistency";
import type { Policy } from "@/lib/types";
import { SimulatedHermesStripeSkillsAdapter } from "./fakes";

const payments = new SimulatedHermesStripeSkillsAdapter();

describe("ledger consistency", () => {
  it("proves the current policy row is backed by status-changing workflow events", async () => {
    const run = await runGaugeDemoWorkflow({ payments });

    expect(run.ledgerConsistency.consistent).toBe(true);
    expect(run.ledgerConsistency.checks[0]).toMatchObject({
      policyId: run.policy.id,
      currentStatus: "payout_issued",
      projectedStatus: "payout_issued",
      consistent: true
    });
  });

  it("ignores audit_generated when projecting operational policy status", async () => {
    const run = await runGaugeDemoWorkflow({ payments });
    const projection = projectPolicyStatusFromEvents(run.policy.id, run.ledger.workflowEvents);

    expect(projection.status).toBe("payout_issued");
    expect(projection.sourceEventId).toContain("payout_issued");
  });

  it("detects drift between the current row and the ledger projection", async () => {
    const run = await runGaugeDemoWorkflow({ payments });
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

const base = {
  id: "p",
  certificateId: "c",
  customerName: "C",
  eventName: "E",
  locationName: "L",
  premium: { amount: 30, currency: "USD" },
  payout: { amount: 500, currency: "USD" },
  trigger: {
    variable: "rainfall_mm",
    operator: ">",
    threshold: 5,
    aggregation: "sum",
    window: { start: "", end: "" }
  },
  weatherOracleSource: "demo_replay",
  status: "policy_quoted"
} as unknown as Policy;

it("flags a dynamic priced policy with no evidence and no fallback", () => {
  expect(assertDynamicPricingEvidence({ ...base, pricingMode: "dynamic" })).toMatch(/evidence/i);
});
it("accepts operator_research with citations", () => {
  expect(
    assertDynamicPricingEvidence({
      ...base,
      pricingMode: "dynamic",
      pricedBy: "operator_research",
      riskCitations: [{ url: "u", title: "t", snippet: "s", retrievedAt: "r" }]
    })
  ).toBeUndefined();
});
it("accepts a recorded deterministic fallback", () => {
  expect(
    assertDynamicPricingEvidence({ ...base, pricingMode: "dynamic", pricedBy: "deterministic_fallback" })
  ).toBeUndefined();
});
it("ignores static policies", () => {
  expect(assertDynamicPricingEvidence(base)).toBeUndefined();
});
