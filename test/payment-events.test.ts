import { describe, expect, it } from "vitest";
import { demoCoverageRequest, demoWeatherEvidence } from "@/lib/demo-fixtures";
import {
  handlePayoutCompletedEvent,
  handlePayoutFailedEvent,
  handlePayoutRequestedEvent,
  handlePremiumCollectedEvent
} from "@/lib/payment-events";
import { InMemoryPolicyStore } from "@/lib/policy-store";
import {
  activateMonitoring,
  approveClaim,
  evaluateTrigger,
  issuePolicy,
  quotePolicy,
  recordTriggerData,
  recordTriggerEvaluation
} from "@/lib/workflow";

async function quotedStore() {
  const store = new InMemoryPolicyStore();
  const policy = quotePolicy(demoCoverageRequest);
  await store.savePolicy(policy);
  return { store, policy };
}

async function approvedClaimStore() {
  const { store, policy } = await quotedStore();
  const premium = await handlePremiumCollectedEvent(
    {
      providerEventId: "evt_test_premium_for_payout",
      checkoutId: "cs_test_premium_for_payout",
      policyId: policy.id,
      amount: policy.premium,
      mode: "stripe_test_mode",
      paidAt: "2026-06-17T09:02:15-04:00"
    },
    store
  );
  if (!premium.accepted) throw new Error("Expected premium event setup.");

  const issued = issuePolicy(premium.policy, "2026-06-17T09:02:18-04:00");
  const triggerData = recordTriggerData(activateMonitoring(issued));
  const decision = evaluateTrigger(triggerData, demoWeatherEvidence);
  const approved = approveClaim(recordTriggerEvaluation(triggerData));
  await store.savePolicy(approved);

  return { store, policy: approved, decision };
}

describe("payment events", () => {
  it("activates a quoted policy from a premium_collected event", async () => {
    const { store, policy } = await quotedStore();

    const result = await handlePremiumCollectedEvent(
      {
        providerEventId: "evt_test_premium_001",
        checkoutId: "cs_test_premium_001",
        policyId: policy.id,
        amount: policy.premium,
        mode: "stripe_test_mode",
        paidAt: "2026-06-17T09:02:15-04:00"
      },
      store
    );

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error("Expected accepted premium event.");
    expect(result.policy.status).toBe("premium_paid");
    expect(result.paymentEvent.reference).toBe("cs_test_premium_001");

    const issued = issuePolicy(result.policy, "2026-06-17T09:02:18-04:00");
    expect(issued.status).toBe("policy_issued");
  });

  it("replays a duplicate premium_collected event idempotently", async () => {
    const { store, policy } = await quotedStore();
    const event = {
      providerEventId: "evt_test_premium_002",
      checkoutId: "cs_test_premium_002",
      policyId: policy.id,
      amount: policy.premium,
      mode: "stripe_test_mode" as const,
      paidAt: "2026-06-17T09:02:15-04:00"
    };

    const first = await handlePremiumCollectedEvent(event, store);
    const second = await handlePremiumCollectedEvent(event, store);

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    if (!first.accepted || !second.accepted) throw new Error("Expected idempotent premium event.");
    expect(first.idempotentReplay).toBe(false);
    expect(second.idempotentReplay).toBe(true);
    expect(second.paymentEvent).toEqual(first.paymentEvent);
  });

  it("rejects premium_collected events with mismatched amounts", async () => {
    const { store, policy } = await quotedStore();

    const result = await handlePremiumCollectedEvent(
      {
        providerEventId: "evt_test_premium_low",
        checkoutId: "cs_test_premium_low",
        policyId: policy.id,
        amount: {
          amount: 10,
          currency: "USD"
        },
        mode: "stripe_test_mode",
        paidAt: "2026-06-17T09:02:15-04:00"
      },
      store
    );

    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error("Expected amount mismatch rejection.");
    expect(result.reasonCode).toBe("premium_amount_mismatch");
  });

  it("records payout_requested before payout completion", async () => {
    const { store, policy } = await approvedClaimStore();

    const result = await handlePayoutRequestedEvent(
      {
        requestId: "payout-request-test-001",
        policyId: policy.id,
        amount: policy.payout,
        mode: "stripe_test_mode",
        requestedAt: "2026-06-17T18:10:03-04:00"
      },
      store
    );

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error("Expected accepted payout request.");
    expect(result.policy.status).toBe("claim_approved");
    expect(result.paymentEvent.kind).toBe("payout_requested");
  });

  it("completes payout only after a payout request exists", async () => {
    const { store, policy, decision } = await approvedClaimStore();
    await handlePayoutRequestedEvent(
      {
        requestId: "payout-request-test-002",
        policyId: policy.id,
        amount: policy.payout,
        mode: "stripe_test_mode",
        requestedAt: "2026-06-17T18:10:03-04:00"
      },
      store
    );

    const result = await handlePayoutCompletedEvent(
      {
        providerEventId: "evt_test_payout_completed_002",
        requestId: "payout-request-test-002",
        payoutReference: "po_test_completed_002",
        policyId: policy.id,
        amount: policy.payout,
        mode: "stripe_test_mode",
        paidAt: "2026-06-17T18:10:04-04:00"
      },
      store,
      decision
    );

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error("Expected payout completion.");
    expect(result.policy.status).toBe("payout_issued");
    expect(result.paymentEvent.kind).toBe("payout_issued");
  });

  it("rejects payout completion when no payout request exists", async () => {
    const { store, policy, decision } = await approvedClaimStore();

    const result = await handlePayoutCompletedEvent(
      {
        providerEventId: "evt_test_payout_without_request",
        requestId: "missing-payout-request",
        payoutReference: "po_test_missing_request",
        policyId: policy.id,
        amount: policy.payout,
        mode: "stripe_test_mode",
        paidAt: "2026-06-17T18:10:04-04:00"
      },
      store,
      decision
    );

    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error("Expected missing payout request rejection.");
    expect(result.reasonCode).toBe("payout_not_requested");
  });

  it("records payout failure without changing claim approval state", async () => {
    const { store, policy } = await approvedClaimStore();
    await handlePayoutRequestedEvent(
      {
        requestId: "payout-request-test-003",
        policyId: policy.id,
        amount: policy.payout,
        mode: "stripe_test_mode",
        requestedAt: "2026-06-17T18:10:03-04:00"
      },
      store
    );

    const result = await handlePayoutFailedEvent(
      {
        providerEventId: "evt_test_payout_failed_003",
        requestId: "payout-request-test-003",
        policyId: policy.id,
        amount: policy.payout,
        mode: "stripe_test_mode",
        failedAt: "2026-06-17T18:10:04-04:00",
        failureReason: "simulated_stripe_failure"
      },
      store
    );

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error("Expected payout failure event.");
    expect(result.policy.status).toBe("claim_approved");
    expect(result.paymentEvent.kind).toBe("payout_failed");
  });

  it("rejects payout failure after payout has completed", async () => {
    const { store, policy, decision } = await approvedClaimStore();
    await handlePayoutRequestedEvent(
      {
        requestId: "payout-request-test-004",
        policyId: policy.id,
        amount: policy.payout,
        mode: "stripe_test_mode",
        requestedAt: "2026-06-17T18:10:03-04:00"
      },
      store
    );
    await handlePayoutCompletedEvent(
      {
        providerEventId: "evt_test_payout_completed_004",
        requestId: "payout-request-test-004",
        payoutReference: "po_test_completed_004",
        policyId: policy.id,
        amount: policy.payout,
        mode: "stripe_test_mode",
        paidAt: "2026-06-17T18:10:04-04:00"
      },
      store,
      decision
    );

    const failure = await handlePayoutFailedEvent(
      {
        providerEventId: "evt_test_payout_failed_after_completed_004",
        requestId: "payout-request-test-004",
        policyId: policy.id,
        amount: policy.payout,
        mode: "stripe_test_mode",
        failedAt: "2026-06-17T18:10:05-04:00",
        failureReason: "late_failure_after_success"
      },
      store
    );

    expect(failure.accepted).toBe(false);
    if (failure.accepted) throw new Error("Expected payout failure after completion to be rejected.");
    expect(failure.reasonCode).toBe("payout_already_completed");
  });
});
