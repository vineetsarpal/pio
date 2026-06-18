import type {
  CoverageRequest,
  GaugeAction,
  Money,
  Policy,
  SettlementResult,
  TriggerDecision,
  WeatherEvidence
} from "./types";
import { transitionPolicy } from "./state-machine";

const USD = (amount: number): Money => ({ amount, currency: "USD" });

export function quotePolicy(request: CoverageRequest): Policy {
  const premium = USD(25);

  if (request.maximumPremium && premium.amount > request.maximumPremium.amount) {
    throw new Error("Premium exceeds the maximum budget for this coverage request.");
  }

  return {
    id: "pio-pol-2026-0001",
    certificateId: "PIO-DEMO-CERT-RAIN-0001",
    customerName: request.customerName,
    eventName: request.eventName,
    locationName: request.locationName,
    premium,
    payout: request.desiredPayout,
    trigger: {
      variable: "rainfall_mm",
      operator: ">",
      threshold: 5,
      aggregation: "sum",
      window: {
        start: request.eventStart,
        end: request.eventEnd
      }
    },
    weatherOracleSource: "demo_replay",
    status: "policy_quoted"
  };
}

export function markPremiumPaid(policy: Policy, paymentReference: string, paidAt: string): Policy {
  return transitionPolicy(policy, "premium_paid", {
    stripePaymentReference: paymentReference,
    paidAt
  });
}

export function issuePolicy(policy: Policy, issuedAt: string): Policy {
  if (!policy.stripePaymentReference || policy.status !== "premium_paid") {
    throw new Error("A policy can only be issued after premium payment is verified.");
  }

  return transitionPolicy(policy, "policy_issued", {
    issuedAt
  });
}

export function activateMonitoring(policy: Policy): Policy {
  return transitionPolicy(policy, "monitoring_active");
}

export function recordTriggerData(policy: Policy): Policy {
  return transitionPolicy(policy, "trigger_data_received");
}

export function recordTriggerEvaluation(policy: Policy): Policy {
  return transitionPolicy(policy, "trigger_evaluated");
}

export function approveClaim(policy: Policy): Policy {
  return transitionPolicy(policy, "claim_approved");
}

export function evaluateTrigger(policy: Policy, evidence: WeatherEvidence): TriggerDecision {
  const start = new Date(policy.trigger.window.start).getTime();
  const end = new Date(policy.trigger.window.end).getTime();
  const observationsInWindow = evidence.observations.filter((observation) => {
    const observedAt = new Date(observation.observedAt).getTime();
    return observedAt >= start && observedAt <= end;
  });
  const missingInWindow = observationsInWindow.filter((observation) => observation.rainfallMm === null).length;
  const manualReviewRequired =
    missingInWindow > 0 ||
    evidence.metadata.missingObservationCount > 0 ||
    !evidence.metadata.settlementGrade ||
    evidence.metadata.advisoryOnly;
  const rainfallTotalMm = observationsInWindow.reduce(
    (total, observation) => total + (observation.rainfallMm ?? 0),
    0
  );

  const approved = !manualReviewRequired && rainfallTotalMm > policy.trigger.threshold;

  return {
    approved,
    manualReviewRequired,
    rainfallTotalMm,
    thresholdMm: policy.trigger.threshold,
    reason: manualReviewRequired
      ? `Settlement requires manual review because oracle evidence is advisory or incomplete under the ${evidence.metadata.missingDataPolicy} policy.`
      : approved
        ? `Rainfall totaled ${rainfallTotalMm.toFixed(1)} mm during the covered window, above the ${policy.trigger.threshold} mm trigger.`
        : `Rainfall totaled ${rainfallTotalMm.toFixed(1)} mm during the covered window, at or below the ${policy.trigger.threshold} mm trigger.`
  };
}

export function settleClaim(
  policy: Policy,
  decision: TriggerDecision,
  payoutReference: string,
  settledAt: string
): SettlementResult {
  if (policy.stripePayoutReference) {
    throw new Error("Policy has already paid once.");
  }

  if (!policy.stripePaymentReference) {
    throw new Error("Settlement is blocked until the premium payment is verified.");
  }

  if (!decision.approved) {
    if (policy.status !== "trigger_evaluated") {
      throw new Error("A non-triggered claim can only be closed after trigger evaluation.");
    }

    return {
      policy: transitionPolicy(policy, decision.manualReviewRequired ? "manual_review" : "not_triggered", {
        settledAt
      }),
      decision
    };
  }

  if (policy.status !== "claim_approved") {
    throw new Error("A payout can only be issued after deterministic claim approval.");
  }

  return {
    policy: transitionPolicy(policy, "payout_issued", {
      stripePayoutReference: payoutReference,
      settledAt
    }),
    decision,
    payoutReference
  };
}

export function generateGaugeActions(policy: Policy, evidence: WeatherEvidence, result: SettlementResult): GaugeAction[] {
  return [
    {
      id: "act-001",
      at: "2026-06-17T09:01:00-04:00",
      actor: "Gauge",
      action: "Coverage request parsed",
      detail: `${policy.customerName} requested rain cover for ${policy.eventName}.`,
      status: "complete"
    },
    {
      id: "act-002",
      at: "2026-06-17T09:01:03-04:00",
      actor: "PIO deterministic engine",
      action: "Quote generated",
      detail: `$${policy.premium.amount} premium for a fixed $${policy.payout.amount} payout if rainfall exceeds ${policy.trigger.threshold} mm.`,
      status: "complete"
    },
    {
      id: "act-003",
      at: "2026-06-17T09:02:15-04:00",
      actor: "Stripe Skill",
      action: "Premium collected",
      detail: `Test-mode payment reference ${policy.stripePaymentReference ?? "pending"}.`,
      status: policy.stripePaymentReference ? "complete" : "pending"
    },
    {
      id: "act-004",
      at: "2026-06-17T09:02:18-04:00",
      actor: "PIO deterministic engine",
      action: "Policy issued",
      detail: `Certificate ${policy.certificateId} activated after payment verification.`,
      status: policy.issuedAt ? "complete" : "blocked"
    },
    {
      id: "act-005",
      at: "2026-06-17T18:10:00-04:00",
      actor: "Weather oracle",
      action: "Demo replay checked",
      detail: `${evidence.source} returned ${evidence.observations.length} normalized rainfall observations.`,
      status: "complete"
    },
    {
      id: "act-006",
      at: "2026-06-17T18:10:01-04:00",
      actor: "PIO deterministic engine",
      action: "Trigger evaluated",
      detail: result.decision.reason,
      status: "complete"
    },
    {
      id: "act-007",
      at: "2026-06-17T18:10:04-04:00",
      actor: "Stripe Skill",
      action: "Payout initiated",
      detail: result.payoutReference
        ? `Fixed payout sent in test mode with reference ${result.payoutReference}.`
        : "No payout sent because the trigger was not approved.",
      status: result.payoutReference ? "complete" : "blocked"
    },
    {
      id: "act-008",
      at: "2026-06-17T18:10:07-04:00",
      actor: "Gauge",
      action: "Audit report drafted",
      detail: "Narrative generated from policy terms, payment references, weather evidence, and deterministic decision.",
      status: "complete"
    }
  ];
}
