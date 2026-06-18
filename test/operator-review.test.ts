import { describe, expect, it } from "vitest";
import { demoCoverageRequest, demoWeatherEvidence } from "@/lib/demo-fixtures";
import { buildOperatorReviewQueue } from "@/lib/operator-review";
import {
  handlePayoutFailedEvent,
  handlePayoutRequestedEvent,
  handlePremiumCollectedEvent
} from "@/lib/payment-events";
import { InMemoryPolicyStore, workflowEvent } from "@/lib/policy-store";
import type { WeatherEvidence } from "@/lib/types";
import {
  activateMonitoring,
  approveClaim,
  evaluateTrigger,
  issuePolicy,
  quotePolicy,
  recordTriggerData,
  recordTriggerEvaluation,
  settleClaim
} from "@/lib/workflow";

describe("operator review queue", () => {
  it("stays empty when no exception events exist", async () => {
    const store = new InMemoryPolicyStore();
    const policy = quotePolicy(demoCoverageRequest);
    await store.savePolicy(policy);

    const ledger = await store.snapshot();

    expect(buildOperatorReviewQueue(ledger)).toEqual([]);
  });

  it("opens a manual weather review from advisory oracle evidence", async () => {
    const store = new InMemoryPolicyStore();
    const quoted = quotePolicy(demoCoverageRequest);
    await store.savePolicy(quoted);
    const paid = await handlePremiumCollectedEvent(
      {
        providerEventId: "evt_test_review_premium",
        checkoutId: "cs_test_review_premium",
        policyId: quoted.id,
        amount: quoted.premium,
        mode: "stripe_test_mode",
        paidAt: "2026-06-17T09:02:15-04:00"
      },
      store
    );
    if (!paid.accepted) throw new Error("Expected premium setup.");

    const advisoryEvidence: WeatherEvidence = {
      ...demoWeatherEvidence,
      metadata: {
        ...demoWeatherEvidence.metadata,
        settlementGrade: false,
        advisoryOnly: true
      }
    };
    const triggerData = recordTriggerData(activateMonitoring(issuePolicy(paid.policy, "2026-06-17T09:02:18-04:00")));
    const decision = evaluateTrigger(triggerData, advisoryEvidence);
    const evaluated = recordTriggerEvaluation(triggerData);
    const settlement = settleClaim(evaluated, decision, "po_test_blocked", "2026-06-17T18:10:04-04:00");

    await store.savePolicy(settlement.policy);
    await store.appendWorkflowEvent(
      workflowEvent({
        policyId: settlement.policy.id,
        at: "2026-06-17T18:10:04-04:00",
        kind: "manual_review",
        actor: "PIO deterministic engine",
        summary: decision.reason,
        data: { settlement }
      })
    );

    const queue = buildOperatorReviewQueue(await store.snapshot());

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      policyId: settlement.policy.id,
      reason: "manual_weather_review",
      severity: "medium",
      status: "open",
      title: "Review weather evidence"
    });
    expect(queue[0].summary).toContain("manual review");
  });

  it("opens a high-priority item for failed payouts", async () => {
    const store = new InMemoryPolicyStore();
    const quoted = quotePolicy(demoCoverageRequest);
    await store.savePolicy(quoted);
    const premium = await handlePremiumCollectedEvent(
      {
        providerEventId: "evt_test_failed_payout_premium",
        checkoutId: "cs_test_failed_payout_premium",
        policyId: quoted.id,
        amount: quoted.premium,
        mode: "stripe_test_mode",
        paidAt: "2026-06-17T09:02:15-04:00"
      },
      store
    );
    if (!premium.accepted) throw new Error("Expected premium setup.");

    const triggerData = recordTriggerData(activateMonitoring(issuePolicy(premium.policy, "2026-06-17T09:02:18-04:00")));
    const decision = evaluateTrigger(triggerData, demoWeatherEvidence);
    const approved = approveClaim(recordTriggerEvaluation(triggerData));
    await store.savePolicy(approved);
    await handlePayoutRequestedEvent(
      {
        requestId: "payout-request-review",
        policyId: approved.id,
        amount: approved.payout,
        mode: "stripe_test_mode",
        requestedAt: "2026-06-17T18:10:03-04:00"
      },
      store
    );
    const failure = await handlePayoutFailedEvent(
      {
        providerEventId: "evt_test_payout_failed_review",
        requestId: "payout-request-review",
        policyId: approved.id,
        amount: approved.payout,
        mode: "stripe_test_mode",
        failedAt: "2026-06-17T18:10:04-04:00",
        failureReason: "simulated_stripe_failure"
      },
      store
    );
    if (!failure.accepted) throw new Error("Expected payout failure setup.");

    const queue = buildOperatorReviewQueue(await store.snapshot());

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      policyId: approved.id,
      reason: "payout_failed",
      severity: "high",
      title: "Resolve failed payout",
      sourceEventId: "evt_test_payout_failed_review"
    });
    expect(queue[0].summary).toContain("simulated_stripe_failure");
    expect(decision.approved).toBe(true);
  });
});
