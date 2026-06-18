import { describe, expect, it } from "vitest";
import type { Policy, WeatherEvidence } from "@/lib/types";
import { demoWeatherEvidence } from "@/lib/demo-fixtures";
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

const request = {
  customerName: "North Pier Pop-up Market",
  eventName: "Saturday Harbor Market",
  locationName: "Toronto Waterfront",
  latitude: 43.6405,
  longitude: -79.3764,
  eventStart: "2026-06-20T12:00:00-04:00",
  eventEnd: "2026-06-20T18:00:00-04:00",
  desiredPayout: {
    amount: 500,
    currency: "USD" as const
  }
};

function issuedPolicy(): Policy {
  const quoted = quotePolicy(request);
  const paid = markPremiumPaid(quoted, "cs_test_paid", "2026-06-17T09:02:15-04:00");
  return issuePolicy(paid, "2026-06-17T09:02:18-04:00");
}

function triggerReadyPolicy(policy: Policy): Policy {
  return recordTriggerData(activateMonitoring(policy));
}

function settlementReadyPolicy(policy: Policy, decisionApproved: boolean): Policy {
  const evaluated = recordTriggerEvaluation(policy);
  return decisionApproved ? approveClaim(evaluated) : evaluated;
}

function settlementGradeEvidence(observations: WeatherEvidence["observations"]): WeatherEvidence {
  return {
    source: "demo_replay",
    metadata: {
      ...demoWeatherEvidence.metadata,
      missingObservationCount: observations.filter((observation) => observation.rainfallMm === null).length
    },
    observations
  };
}

describe("workflow", () => {
  it("approves fixed payout when rainfall exceeds the threshold during the coverage window", () => {
    const policy = issuedPolicy();
    const evidence = settlementGradeEvidence([
      { observedAt: "2026-06-20T12:00:00-04:00", rainfallMm: 2.5 },
      { observedAt: "2026-06-20T15:00:00-04:00", rainfallMm: 3.1 },
      { observedAt: "2026-06-20T19:00:00-04:00", rainfallMm: 10 }
    ]);

    const withTriggerData = triggerReadyPolicy(policy);
    const decision = evaluateTrigger(withTriggerData, evidence);
    const result = settleClaim(
      settlementReadyPolicy(withTriggerData, decision.approved),
      decision,
      "po_test_approved",
      "2026-06-17T18:10:04-04:00"
    );

    expect(decision.approved).toBe(true);
    expect(decision.manualReviewRequired).toBe(false);
    expect(decision.rainfallTotalMm).toBe(5.6);
    expect(result.policy.status).toBe("payout_issued");
    expect(result.policy.stripePayoutReference).toBe("po_test_approved");
  });

  it("does not count rainfall outside the coverage window", () => {
    const policy = issuedPolicy();
    const evidence = settlementGradeEvidence([
      { observedAt: "2026-06-20T11:00:00-04:00", rainfallMm: 10 },
      { observedAt: "2026-06-20T13:00:00-04:00", rainfallMm: 2 },
      { observedAt: "2026-06-20T19:00:00-04:00", rainfallMm: 10 }
    ]);

    const withTriggerData = triggerReadyPolicy(policy);
    const decision = evaluateTrigger(withTriggerData, evidence);
    const result = settleClaim(
      settlementReadyPolicy(withTriggerData, decision.approved),
      decision,
      "po_test_blocked",
      "2026-06-17T18:10:04-04:00"
    );

    expect(decision.approved).toBe(false);
    expect(decision.manualReviewRequired).toBe(false);
    expect(decision.rainfallTotalMm).toBe(2);
    expect(result.policy.status).toBe("not_triggered");
    expect(result.policy.stripePayoutReference).toBeUndefined();
  });

  it("blocks policy issuance until premium payment is verified", () => {
    const quoted = quotePolicy(request);

    expect(() => issuePolicy(quoted, "2026-06-17T09:02:18-04:00")).toThrow(
      "premium payment is verified"
    );
  });

  it("blocks duplicate payouts", () => {
    const policy = issuedPolicy();
    const evidence = settlementGradeEvidence([{ observedAt: "2026-06-20T12:00:00-04:00", rainfallMm: 6 }]);
    const withTriggerData = triggerReadyPolicy(policy);
    const decision = evaluateTrigger(withTriggerData, evidence);
    const firstSettlement = settleClaim(
      settlementReadyPolicy(withTriggerData, decision.approved),
      decision,
      "po_test_once",
      "2026-06-17T18:10:04-04:00"
    );

    expect(() =>
      settleClaim(firstSettlement.policy, decision, "po_test_twice", "2026-06-17T18:11:04-04:00")
    ).toThrow("already paid once");
  });

  it("fails closed when settlement evidence has missing rainfall data", () => {
    const policy = triggerReadyPolicy(issuedPolicy());
    const evidence = settlementGradeEvidence([
      { observedAt: "2026-06-20T12:00:00-04:00", rainfallMm: null },
      { observedAt: "2026-06-20T13:00:00-04:00", rainfallMm: 8 }
    ]);

    const decision = evaluateTrigger(policy, evidence);

    expect(decision.approved).toBe(false);
    expect(decision.manualReviewRequired).toBe(true);
    const evaluated = recordTriggerEvaluation(policy);
    const result = settleClaim(evaluated, decision, "po_test_manual_review", "2026-06-17T18:10:04-04:00");

    expect(decision.reason).toContain("manual review");
    expect(result.policy.status).toBe("manual_review");
  });

  it("treats advisory oracle evidence as manual review even when rainfall exceeds threshold", () => {
    const policy = triggerReadyPolicy(issuedPolicy());
    const evidence: WeatherEvidence = {
      ...settlementGradeEvidence([{ observedAt: "2026-06-20T12:00:00-04:00", rainfallMm: 8 }]),
      source: "open_meteo",
      metadata: {
        ...demoWeatherEvidence.metadata,
        settlementGrade: false,
        advisoryOnly: true,
        sourceUrl: "https://api.open-meteo.com/v1/forecast",
        snapshotId: "wx-open-meteo-advisory"
      }
    };

    const decision = evaluateTrigger(policy, evidence);

    expect(decision.approved).toBe(false);
    expect(decision.manualReviewRequired).toBe(true);
  });
});
