import type { CoverageRequest, Policy, TriggerDecision } from "./types";
import type { PolicyStore } from "./policy-store";
import type { WeatherOracle } from "./weather-oracle";
import { workflowEvent } from "./policy-store";
import { handlePayoutRequestedEvent } from "./payment-events";
import {
  activateMonitoring,
  approveClaim,
  evaluateTrigger,
  recordTriggerData,
  recordTriggerEvaluation,
  settleClaim
} from "./workflow";

export type OperatorSettlementResult =
  | { accepted: false; reasonCode: "policy_not_found" | "invalid_policy_state"; message: string }
  | {
      accepted: true;
      outcome: "payout_requested";
      policy: Policy;
      decision: TriggerDecision;
      payoutRequestId: string;
    }
  | {
      accepted: true;
      outcome: "not_triggered" | "manual_review";
      policy: Policy;
      decision: TriggerDecision;
    };

/**
 * The operator (Gauge) settlement action: pull oracle evidence, evaluate the
 * trigger deterministically, and advance the policy to its settlement boundary.
 *
 * The deterministic invariant holds: this orchestrator NEVER decides the
 * payout — `evaluateTrigger` does. On approval it only *requests* the payout
 * (claim_approved → payout_requested); the actual money movement to
 * payout_issued arrives via the verified Stripe `payout.paid` webhook, exactly
 * as premium collection depends on its webhook rather than a redirect.
 */
export async function runOperatorSettlement(
  input: { policyId: string; now: string },
  deps: { store: PolicyStore; oracle: WeatherOracle }
): Promise<OperatorSettlementResult> {
  const { store, oracle } = deps;

  const policy = await store.getPolicy(input.policyId);
  if (!policy) {
    return { accepted: false, reasonCode: "policy_not_found", message: `Policy ${input.policyId} was not found.` };
  }
  if (policy.status !== "policy_issued") {
    return {
      accepted: false,
      reasonCode: "invalid_policy_state",
      message: `Settlement requires a policy_issued policy, not ${policy.status}.`
    };
  }

  const evidence = await oracle.getRainfall(coverageRequestFromPolicy(policy));
  const decision = evaluateTrigger(policy, evidence);

  // Advance monitoring → trigger_evaluated, persisting each transition + event.
  const monitoring = activateMonitoring(policy);
  await store.savePolicy(monitoring);
  await store.appendWorkflowEvent(
    workflowEvent({
      policyId: policy.id,
      at: input.now,
      kind: "monitoring_started",
      actor: "Gauge",
      summary: "Operator opened monitoring for the covered window.",
      data: { status: monitoring.status }
    })
  );

  const withData = recordTriggerData(monitoring);
  await store.savePolicy(withData);
  await store.appendWorkflowEvent(
    workflowEvent({
      policyId: policy.id,
      at: input.now,
      kind: "trigger_data_received",
      actor: "Weather oracle",
      summary: "Operator pulled normalized oracle observations.",
      data: { source: evidence.source, metadata: evidence.metadata, observations: evidence.observations }
    })
  );

  const evaluated = recordTriggerEvaluation(withData);
  await store.savePolicy(evaluated);
  await store.appendWorkflowEvent(
    workflowEvent({
      policyId: policy.id,
      at: input.now,
      kind: "trigger_evaluated",
      actor: "PIO deterministic engine",
      summary: decision.reason,
      data: { decision }
    })
  );

  if (decision.approved) {
    const approved = approveClaim(evaluated);
    await store.savePolicy(approved);
    await store.appendWorkflowEvent(
      workflowEvent({
        policyId: policy.id,
        at: input.now,
        kind: "claim_approved",
        actor: "PIO deterministic engine",
        summary: "Deterministic evaluator approved the fixed payout.",
        data: { decision }
      })
    );

    const payoutRequestId = `payout-request-${policy.id}`;
    const requested = await handlePayoutRequestedEvent(
      {
        requestId: payoutRequestId,
        policyId: policy.id,
        amount: policy.payout,
        mode: "stripe_test_mode",
        requestedAt: input.now
      },
      store
    );
    if (!requested.accepted) {
      return { accepted: false, reasonCode: "invalid_policy_state", message: requested.message };
    }

    return { accepted: true, outcome: "payout_requested", policy: approved, decision, payoutRequestId };
  }

  const settlement = settleClaim(evaluated, decision, "po_unpaid", input.now);
  await store.savePolicy(settlement.policy);
  await store.appendWorkflowEvent(
    workflowEvent({
      policyId: policy.id,
      at: input.now,
      kind: decision.manualReviewRequired ? "manual_review" : "claim_not_triggered",
      actor: "PIO deterministic engine",
      summary: decision.manualReviewRequired
        ? "Claim moved to manual review because oracle evidence was advisory or incomplete."
        : "Claim was not triggered, so no payout was issued.",
      data: { settlement }
    })
  );

  return {
    accepted: true,
    outcome: decision.manualReviewRequired ? "manual_review" : "not_triggered",
    policy: settlement.policy,
    decision
  };
}

/**
 * Reconstruct the oracle query input from a bound policy. The demo-replay oracle
 * ignores coordinates; a live oracle would need real lat/long, which the policy
 * does not yet persist — a known limitation noted for the live settlement path.
 */
function coverageRequestFromPolicy(policy: Policy): CoverageRequest {
  return {
    customerName: policy.customerName,
    eventName: policy.eventName,
    locationName: policy.locationName,
    latitude: 0,
    longitude: 0,
    eventStart: policy.trigger.window.start,
    eventEnd: policy.trigger.window.end,
    desiredPayout: policy.payout
  };
}
