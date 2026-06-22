import type { CoverageRequest, GaugeDemoRun, PaymentMode, Policy, TriggerDecision, WeatherEvidence } from "./types";
import { createFinalAuditSnapshot, generateAuditReport, generateAuditTrail } from "./audit";
import { demoCoverageRequest } from "./demo-fixtures";
import { validateLedgerConsistency } from "./ledger-consistency";
import { buildOperatorReviewQueue } from "./operator-review";
import type { PaymentAdapter } from "./payment-adapter";
import type { PolicyStore } from "./policy-store";
import type { WeatherOracle } from "./weather-oracle";
import {
  handlePayoutCompletedEvent,
  handlePayoutRequestedEvent,
  handlePremiumCollectedEvent
} from "./payment-events";
import { InMemoryPolicyStore, workflowEvent } from "./policy-store";
import { createWeatherOracle } from "./weather-oracle";
import {
  activateMonitoring,
  approveClaim,
  evaluateTrigger,
  generateGaugeActions,
  issuePolicy,
  quotePolicy,
  recordTriggerData,
  recordTriggerEvaluation,
  settleClaim
} from "./workflow";

export async function runGaugeDemoWorkflow({
  payments,
  request = demoCoverageRequest,
  weatherSource = "demo_replay",
  oracle = createWeatherOracle(weatherSource),
  store = new InMemoryPolicyStore()
}: {
  payments: PaymentAdapter;
  request?: CoverageRequest;
  weatherSource?: WeatherEvidence["source"];
  oracle?: WeatherOracle;
  store?: PolicyStore;
}): Promise<GaugeDemoRun> {
  const quotedPolicy = quotePolicy(request);
  await store.savePolicy(quotedPolicy);
  await store.appendWorkflowEvent(
    workflowEvent({
      policyId: quotedPolicy.id,
      at: "2026-06-17T09:01:00-04:00",
      kind: "coverage_requested",
      actor: "Gauge",
      summary: `${request.customerName} requested rain cover for ${request.eventName}.`,
      data: { request }
    })
  );
  await store.appendWorkflowEvent(
    workflowEvent({
      policyId: quotedPolicy.id,
      at: "2026-06-17T09:01:03-04:00",
      kind: "policy_quoted",
      actor: "PIO deterministic engine",
      summary: "Deterministic quote returned premium, payout, trigger, and coverage window.",
      data: { premium: quotedPolicy.premium, payout: quotedPolicy.payout, trigger: quotedPolicy.trigger }
    })
  );

  const customer = await payments.createCustomer(request.customerName);
  await store.appendWorkflowEvent(
    workflowEvent({
      policyId: quotedPolicy.id,
      at: "2026-06-17T09:01:05-04:00",
      kind: "stripe_customer_created",
      actor: "Stripe Skill",
      summary: "Stripe test-mode customer was created or retrieved.",
      data: { customer }
    })
  );

  const checkout = await payments.createCheckout(quotedPolicy, customer);
  await store.appendWorkflowEvent(
    workflowEvent({
      policyId: quotedPolicy.id,
      at: "2026-06-17T09:01:08-04:00",
      kind: "stripe_checkout_created",
      actor: "Stripe Skill",
      summary: "Stripe test-mode checkout session was created for the premium.",
      data: { checkoutId: checkout.id, premium: checkout.premium, mode: checkout.mode }
    })
  );

  const payment = await payments.verifyPayment(checkout);
  if (!payment.paid) {
    throw new Error("Gauge cannot issue policy because premium payment was not verified.");
  }

  const premiumEvent = await handlePremiumCollectedEvent(
    {
      providerEventId: "evt_test_pio_premium_collected_0001",
      checkoutId: payment.paymentReference,
      policyId: quotedPolicy.id,
      amount: quotedPolicy.premium,
      mode: checkout.mode,
      paidAt: payment.paidAt
    },
    store
  );
  if (!premiumEvent.accepted) {
    throw new Error(premiumEvent.message);
  }
  const paidPolicy = premiumEvent.policy;

  const issuedPolicy = issuePolicy(paidPolicy, "2026-06-17T09:02:18-04:00");
  await store.savePolicy(issuedPolicy);
  await store.appendWorkflowEvent(
    workflowEvent({
      policyId: issuedPolicy.id,
      at: issuedPolicy.issuedAt ?? "2026-06-17T09:02:18-04:00",
      kind: "policy_issued",
      actor: "PIO deterministic engine",
      summary: "Policy certificate was activated after payment verification.",
      data: { certificateId: issuedPolicy.certificateId }
    })
  );

  const monitoringPolicy = activateMonitoring(issuedPolicy);
  await store.savePolicy(monitoringPolicy);
  await store.appendWorkflowEvent(
    workflowEvent({
      policyId: monitoringPolicy.id,
      at: "2026-06-17T09:02:20-04:00",
      kind: "monitoring_started",
      actor: "PIO deterministic engine",
      summary: "Policy entered monitoring state for the covered event window.",
      data: { status: monitoringPolicy.status }
    })
  );

  const evidence = await oracle.getRainfall(request);
  const triggerDataPolicy = recordTriggerData(monitoringPolicy);
  await store.savePolicy(triggerDataPolicy);
  await store.appendWorkflowEvent(
    workflowEvent({
      policyId: triggerDataPolicy.id,
      at: "2026-06-17T18:10:00-04:00",
      kind: "trigger_data_received",
      actor: "Weather oracle",
      summary: "Weather oracle returned normalized rainfall observations.",
      data: { source: evidence.source, metadata: evidence.metadata, observations: evidence.observations }
    })
  );

  const decision = evaluateTrigger(triggerDataPolicy, evidence);
  const evaluatedPolicy = recordTriggerEvaluation(triggerDataPolicy);
  await store.savePolicy(evaluatedPolicy);
  await store.appendWorkflowEvent(
    workflowEvent({
      policyId: evaluatedPolicy.id,
      at: "2026-06-17T18:10:01-04:00",
      kind: "trigger_evaluated",
      actor: "PIO deterministic engine",
      summary: decision.reason,
      data: { decision }
    })
  );

  const settlementReadyPolicy = decision.approved ? approveClaim(evaluatedPolicy) : evaluatedPolicy;
  await store.savePolicy(settlementReadyPolicy);
  if (decision.approved) {
    await store.appendWorkflowEvent(
      workflowEvent({
        policyId: settlementReadyPolicy.id,
        at: "2026-06-17T18:10:02-04:00",
        kind: "claim_approved",
        actor: "PIO deterministic engine",
        summary: "Deterministic evaluator approved the fixed payout.",
        data: { decision }
      })
    );
  }

  const payout = decision.approved
    ? await payments.initiatePayout(settlementReadyPolicy)
    : {
        paid: false,
        blockedReason: "Deterministic trigger evaluator did not approve settlement."
      };
  if (decision.approved && !payout.paid) {
    throw new Error(payout.blockedReason ?? "Approved claim payout was not completed.");
  }

  const settlement = decision.approved
    ? await completeApprovedPayout({
        policy: settlementReadyPolicy,
        decision,
        payoutReference: payout.payoutReference ?? "po_test_blocked",
        paidAt: payout.paidAt ?? "2026-06-17T18:10:04-04:00",
        mode: payments.mode,
        store
      })
    : settleClaim(
        settlementReadyPolicy,
        decision,
        "po_test_blocked",
        "2026-06-17T18:10:04-04:00"
      );
  if (!decision.approved) {
    await store.savePolicy(settlement.policy);
    await store.appendWorkflowEvent(
      workflowEvent({
        policyId: settlement.policy.id,
        at: settlement.policy.settledAt ?? "2026-06-17T18:10:04-04:00",
        kind: settlement.decision.manualReviewRequired ? "manual_review" : "claim_not_triggered",
        actor: "PIO deterministic engine",
        summary: settlement.decision.manualReviewRequired
          ? "Claim moved to manual review because oracle evidence was advisory or incomplete."
          : "Claim was not triggered, so no payout was issued.",
        data: { settlement }
      })
    );
  }

  const preAuditLedger = await store.snapshot();
  const audit = generateAuditReport(settlement.policy, evidence, settlement, preAuditLedger.workflowEvents.length + 1);
  await store.appendWorkflowEvent(
    workflowEvent({
      policyId: settlement.policy.id,
      at: audit.generatedAt,
      kind: "audit_generated",
      actor: "Gauge",
      summary: audit.summary,
      data: { audit }
    })
  );
  await store.appendAuditSnapshot(createFinalAuditSnapshot({ policyId: settlement.policy.id, report: audit }));
  const ledger = await store.snapshot();
  const auditTrail = generateAuditTrail({ policy: settlement.policy, evidence, settlement, ledger });
  const operatorReviewQueue = buildOperatorReviewQueue(ledger);
  const ledgerConsistency = validateLedgerConsistency(ledger);

  return {
    request,
    policy: settlement.policy,
    evidence,
    decision,
    settlement,
    audit,
    auditTrail,
    operatorReviewQueue,
    ledgerConsistency,
    actions: generateGaugeActions(settlement.policy, evidence, settlement),
    ledger
  };
}

export const hermesToolManifest = [
  "extractCoverageRequest",
  "quotePolicy",
  "createStripeCustomer",
  "createStripeCheckout",
  "verifyStripePayment",
  "handlePremiumCollectedEvent",
  "issuePolicy",
  "checkWeather",
  "evaluateTrigger",
  "settleClaim",
  "handlePayoutRequestedEvent",
  "handlePayoutCompletedEvent",
  "fetchStripeReceipts",
  "generateAuditReport"
] as const;

async function completeApprovedPayout({
  policy,
  decision,
  payoutReference,
  paidAt,
  mode,
  store
}: {
  policy: Policy;
  decision: TriggerDecision;
  payoutReference: string;
  paidAt: string;
  mode: PaymentMode;
  store: PolicyStore;
}) {
  const requestId = `payout-request-${policy.id}`;
  const requested = await handlePayoutRequestedEvent(
    {
      requestId,
      policyId: policy.id,
      amount: policy.payout,
      mode,
      requestedAt: "2026-06-17T18:10:03-04:00"
    },
    store
  );
  if (!requested.accepted) {
    throw new Error(requested.message);
  }

  const completed = await handlePayoutCompletedEvent(
    {
      providerEventId: "evt_test_pio_payout_completed_0001",
      requestId,
      payoutReference,
      policyId: policy.id,
      amount: policy.payout,
      mode,
      paidAt
    },
    store,
    decision
  );
  if (!completed.accepted) {
    throw new Error(completed.message);
  }

  return {
    policy: completed.policy,
    decision,
    payoutReference
  };
}
