import type { GaugeDemoRun } from "./types";
import { createFinalAuditSnapshot, generateAuditReport, generateAuditTrail } from "./audit";
import { demoCoverageRequest, demoWeatherEvidence } from "./demo-fixtures";
import { validateLedgerConsistency } from "./ledger-consistency";
import { buildOperatorReviewQueue } from "./operator-review";
import { paymentEvent, workflowEvent } from "./policy-store";
import {
  activateMonitoring,
  approveClaim,
  evaluateTrigger,
  generateGaugeActions,
  issuePolicy,
  markPremiumPaid,
  quotePolicy,
  recordTriggerData,
  recordTriggerEvaluation,
  settleClaim
} from "./workflow";

const quotedPolicy = quotePolicy(demoCoverageRequest);
const paidPolicy = markPremiumPaid(quotedPolicy, "cs_test_pio_premium_0001", "2026-06-17T09:02:15-04:00");
const issuedPolicy = issuePolicy(paidPolicy, "2026-06-17T09:02:18-04:00");
const monitoringPolicy = activateMonitoring(issuedPolicy);
const triggerDataPolicy = recordTriggerData(monitoringPolicy);
const triggerDecision = evaluateTrigger(triggerDataPolicy, demoWeatherEvidence);
const evaluatedPolicy = recordTriggerEvaluation(triggerDataPolicy);
const settlementReadyPolicy = triggerDecision.approved ? approveClaim(evaluatedPolicy) : evaluatedPolicy;
const settlementResult = settleClaim(
  settlementReadyPolicy,
  triggerDecision,
  "po_test_pio_claim_0001",
  "2026-06-17T18:10:04-04:00"
);
const auditReport = generateAuditReport(settlementResult.policy, demoWeatherEvidence, settlementResult, 7);
const ledger = {
  policies: [settlementResult.policy],
  workflowEvents: [
    workflowEvent({
      policyId: settlementResult.policy.id,
      at: "2026-06-17T09:01:00-04:00",
      kind: "coverage_requested",
      actor: "Gauge",
      summary: "North Pier Pop-up Market requested rain cover for Saturday Harbor Market.",
      data: { request: demoCoverageRequest }
    }),
    workflowEvent({
      policyId: settlementResult.policy.id,
      at: "2026-06-17T09:01:03-04:00",
      kind: "policy_quoted",
      actor: "PIO deterministic engine",
      summary: "Deterministic quote returned premium, payout, trigger, and coverage window.",
      data: { premium: settlementResult.policy.premium, payout: settlementResult.policy.payout }
    }),
    workflowEvent({
      policyId: settlementResult.policy.id,
      at: "2026-06-17T09:02:15-04:00",
      kind: "premium_verified",
      actor: "Stripe Skill",
      summary: "Premium collection event activated the quoted policy.",
      data: { checkoutId: paidPolicy.stripePaymentReference }
    }),
    workflowEvent({
      policyId: settlementResult.policy.id,
      at: "2026-06-17T18:10:01-04:00",
      kind: "trigger_evaluated",
      actor: "PIO deterministic engine",
      summary: triggerDecision.reason,
      data: { decision: triggerDecision }
    }),
    workflowEvent({
      policyId: settlementResult.policy.id,
      at: "2026-06-17T18:10:03-04:00",
      kind: "payout_requested",
      actor: "PIO deterministic engine",
      summary: "Deterministic settlement requested a fixed payout after claim approval.",
      data: { requestId: `payout-request-${settlementResult.policy.id}` }
    }),
    workflowEvent({
      policyId: settlementResult.policy.id,
      at: settlementResult.policy.settledAt ?? "2026-06-17T18:10:04-04:00",
      kind: "payout_issued",
      actor: "Stripe Skill",
      summary: "Stripe Skill completed the fixed payout after deterministic approval.",
      data: { payoutReference: settlementResult.payoutReference }
    }),
    workflowEvent({
      policyId: settlementResult.policy.id,
      at: auditReport.generatedAt,
      kind: "audit_generated",
      actor: "Gauge",
      summary: auditReport.summary,
      data: { audit: auditReport }
    })
  ],
  paymentEvents: [
    paymentEvent({
      policyId: settlementResult.policy.id,
      at: paidPolicy.paidAt ?? "2026-06-17T09:02:15-04:00",
      kind: "premium_collected",
      reference: paidPolicy.stripePaymentReference ?? "cs_test_pio_premium_0001",
      amount: paidPolicy.premium,
      mode: "stripe_test_mode"
    }),
    paymentEvent({
      policyId: settlementResult.policy.id,
      at: settlementResult.policy.settledAt ?? "2026-06-17T18:10:04-04:00",
      kind: "payout_requested",
      reference: `payout-request-${settlementResult.policy.id}`,
      amount: settlementResult.policy.payout,
      mode: "stripe_test_mode",
      providerEventId: `payout-request-${settlementResult.policy.id}`
    }),
    paymentEvent({
      policyId: settlementResult.policy.id,
      at: settlementResult.policy.settledAt ?? "2026-06-17T18:10:04-04:00",
      kind: "payout_issued",
      reference: settlementResult.payoutReference ?? "po_test_pio_claim_0001",
      amount: settlementResult.policy.payout,
      mode: "stripe_test_mode",
      providerEventId: "evt_test_pio_payout_completed_0001"
    })
  ],
  auditSnapshots: [
    createFinalAuditSnapshot({
      policyId: settlementResult.policy.id,
      report: auditReport
    })
  ]
};
const auditTrail = generateAuditTrail({
  policy: settlementResult.policy,
  evidence: demoWeatherEvidence,
  settlement: settlementResult,
  ledger
});
const operatorReviewQueue = buildOperatorReviewQueue(ledger);
const ledgerConsistency = validateLedgerConsistency(ledger);

export const demoRun: GaugeDemoRun = {
  request: demoCoverageRequest,
  policy: settlementResult.policy,
  evidence: demoWeatherEvidence,
  decision: triggerDecision,
  settlement: settlementResult,
  audit: auditReport,
  auditTrail,
  operatorReviewQueue,
  ledgerConsistency,
  actions: generateGaugeActions(settlementResult.policy, demoWeatherEvidence, settlementResult),
  ledger
};
