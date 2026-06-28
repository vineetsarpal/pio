import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { InMemoryPolicyStore } from "@/lib/policy-store";
import { demoCoverageRequest, demoWeatherEvidence } from "@/lib/demo-fixtures";
import { issuePolicy, markPremiumPaid, quotePolicy } from "@/lib/workflow";
import { runOperatorSettlement } from "@/lib/operator-settlement";
import { handlePayoutCompletedEvent } from "@/lib/payment-events";
import { normalizeStripePayoutEvent, verifyStripeWebhookSignature } from "@/lib/stripe-webhook";
import type { WeatherEvidence } from "@/lib/types";
import type { WeatherOracle } from "@/lib/weather-oracle";

const NOW = "2026-06-20T19:00:00-04:00";
const PAID_AT = 1781800123;
const WEBHOOK_SECRET = "whsec_test_claim_flow";

function stubOracle(evidence: WeatherEvidence): WeatherOracle {
  return {
    source: evidence.source,
    async getRainfall() {
      return evidence;
    }
  };
}

async function seedIssuedPolicy(store: InMemoryPolicyStore) {
  const quoted = quotePolicy(demoCoverageRequest);
  const paid = markPremiumPaid(quoted, "cs_test_seed", "2026-06-18T09:00:00-04:00");
  const issued = issuePolicy(paid, "2026-06-18T09:01:00-04:00");
  await store.savePolicy(issued);
  return issued;
}

/** Build a signed Stripe `payout.paid` event, exactly as the webhook route receives it. */
function signedPayoutPaid(policyId: string, requestId: string, amountCents: number) {
  const event = {
    id: "evt_payout_paid_integration",
    type: "payout.paid",
    created: PAID_AT,
    data: {
      object: {
        id: "po_integration_001",
        object: "payout",
        amount: amountCents,
        currency: "usd",
        status: "paid",
        metadata: { policy_id: policyId, request_id: requestId }
      }
    }
  };
  const payload = JSON.stringify(event);
  const timestamp = PAID_AT;
  const signature = createHmac("sha256", WEBHOOK_SECRET).update(`${timestamp}.${payload}`).digest("hex");
  return { payload, signatureHeader: `t=${timestamp},v1=${signature}` };
}

describe("claim flow: trigger reached → payout issued", () => {
  it("drives an issued policy through deterministic approval and a verified payout.paid into payout_issued", async () => {
    const store = new InMemoryPolicyStore();
    const issued = await seedIssuedPolicy(store);

    // 1. Operator settlement pulls the (trigger-reaching) evidence and approves.
    const settlement = await runOperatorSettlement(
      { policyId: issued.id, now: NOW },
      { store, oracle: stubOracle(demoWeatherEvidence) }
    );
    expect(settlement.accepted).toBe(true);
    if (!settlement.accepted || settlement.outcome !== "payout_requested") {
      throw new Error(`expected payout_requested, got ${settlement.accepted ? settlement.outcome : "rejection"}`);
    }
    // The trigger was genuinely reached: in-window rainfall is above the threshold.
    expect(settlement.decision.approved).toBe(true);
    expect(settlement.decision.rainfallTotalMm).toBeGreaterThan(settlement.decision.thresholdMm);
    expect(settlement.policy.status).toBe("claim_approved");

    // 2. The verified Stripe payout.paid webhook completes the money movement.
    const { payload, signatureHeader } = signedPayoutPaid(
      issued.id,
      settlement.payoutRequestId,
      issued.payout.amount * 100
    );
    expect(verifyStripeWebhookSignature(payload, signatureHeader, WEBHOOK_SECRET).ok).toBe(true);

    const normalized = normalizeStripePayoutEvent(JSON.parse(payload));
    if (!normalized.ok || normalized.type !== "payout.paid") {
      throw new Error("expected a normalized payout.paid event");
    }

    const completed = await handlePayoutCompletedEvent(normalized.completed, store, settlement.decision);
    expect(completed.accepted).toBe(true);
    if (!completed.accepted) throw new Error("expected the payout to complete");
    expect(completed.policy.status).toBe("payout_issued");
    expect(completed.paymentEvent.kind).toBe("payout_issued");
    expect(completed.policy.stripePayoutReference).toBe("po_integration_001");

    // 3. The full money trail is durable on the policy: requested then issued.
    const snapshot = await store.snapshotForPolicy(issued.id);
    expect(snapshot.policies[0]?.status).toBe("payout_issued");
    expect(snapshot.paymentEvents.some((event) => event.kind === "payout_requested")).toBe(true);
    expect(snapshot.paymentEvents.some((event) => event.kind === "payout_issued")).toBe(true);
    expect(snapshot.workflowEvents.some((event) => event.kind === "claim_approved")).toBe(true);
  });

  it("is idempotent: a replayed payout.paid does not pay twice", async () => {
    const store = new InMemoryPolicyStore();
    const issued = await seedIssuedPolicy(store);

    const settlement = await runOperatorSettlement(
      { policyId: issued.id, now: NOW },
      { store, oracle: stubOracle(demoWeatherEvidence) }
    );
    if (!settlement.accepted || settlement.outcome !== "payout_requested") {
      throw new Error("expected payout_requested");
    }

    const { payload } = signedPayoutPaid(issued.id, settlement.payoutRequestId, issued.payout.amount * 100);
    const normalized = normalizeStripePayoutEvent(JSON.parse(payload));
    if (!normalized.ok || normalized.type !== "payout.paid") throw new Error("expected payout.paid");

    const first = await handlePayoutCompletedEvent(normalized.completed, store, settlement.decision);
    const second = await handlePayoutCompletedEvent(normalized.completed, store, settlement.decision);
    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);

    const snapshot = await store.snapshotForPolicy(issued.id);
    expect(snapshot.paymentEvents.filter((event) => event.kind === "payout_issued")).toHaveLength(1);
  });
});
