import { describe, expect, it } from "vitest";
import type { WeatherEvidence } from "@/lib/types";
import type { WeatherOracle } from "@/lib/weather-oracle";
import { InMemoryPolicyStore } from "@/lib/policy-store";
import { demoCoverageRequest, demoWeatherEvidence } from "@/lib/demo-fixtures";
import { issuePolicy, markPremiumPaid, quotePolicy } from "@/lib/workflow";
import { runOperatorSettlement } from "@/lib/operator-settlement";

const NOW = "2026-06-20T19:00:00-04:00";

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

describe("runOperatorSettlement", () => {
  it("requests a payout when deterministic evidence approves the claim", async () => {
    const store = new InMemoryPolicyStore();
    const issued = await seedIssuedPolicy(store);

    const result = await runOperatorSettlement(
      { policyId: issued.id, now: NOW },
      { store, oracle: stubOracle(demoWeatherEvidence) }
    );

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error("expected acceptance");
    expect(result.outcome).toBe("payout_requested");
    expect(result.decision.approved).toBe(true);
    expect(result.policy.status).toBe("claim_approved");

    const snapshot = await store.snapshotForPolicy(issued.id);
    expect(snapshot.paymentEvents.some((event) => event.kind === "payout_requested")).toBe(true);
    expect(snapshot.workflowEvents.some((event) => event.kind === "trigger_evaluated")).toBe(true);
  });

  it("closes as not_triggered when rainfall is below the trigger", async () => {
    const store = new InMemoryPolicyStore();
    const issued = await seedIssuedPolicy(store);
    const dryEvidence: WeatherEvidence = {
      ...demoWeatherEvidence,
      observations: demoWeatherEvidence.observations.map((observation) => ({
        ...observation,
        rainfallMm: 0.1
      }))
    };

    const result = await runOperatorSettlement(
      { policyId: issued.id, now: NOW },
      { store, oracle: stubOracle(dryEvidence) }
    );

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error("expected acceptance");
    expect(result.outcome).toBe("not_triggered");
    expect(result.decision.approved).toBe(false);
    expect(result.policy.status).toBe("not_triggered");

    const snapshot = await store.snapshotForPolicy(issued.id);
    expect(snapshot.paymentEvents.some((event) => event.kind === "payout_requested")).toBe(false);
  });

  it("routes to manual_review when oracle evidence is advisory", async () => {
    const store = new InMemoryPolicyStore();
    const issued = await seedIssuedPolicy(store);
    const advisoryEvidence: WeatherEvidence = {
      ...demoWeatherEvidence,
      metadata: { ...demoWeatherEvidence.metadata, advisoryOnly: true, settlementGrade: false }
    };

    const result = await runOperatorSettlement(
      { policyId: issued.id, now: NOW },
      { store, oracle: stubOracle(advisoryEvidence) }
    );

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error("expected acceptance");
    expect(result.outcome).toBe("manual_review");
    expect(result.decision.manualReviewRequired).toBe(true);
    expect(result.policy.status).toBe("manual_review");
  });

  it("rejects a policy that has not been issued", async () => {
    const store = new InMemoryPolicyStore();
    const quoted = quotePolicy(demoCoverageRequest);
    await store.savePolicy(quoted);

    const result = await runOperatorSettlement(
      { policyId: quoted.id, now: NOW },
      { store, oracle: stubOracle(demoWeatherEvidence) }
    );

    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error("expected rejection");
    expect(result.reasonCode).toBe("invalid_policy_state");
  });

  it("reports policy_not_found for an unknown policy", async () => {
    const store = new InMemoryPolicyStore();

    const result = await runOperatorSettlement(
      { policyId: "pio-pol-missing", now: NOW },
      { store, oracle: stubOracle(demoWeatherEvidence) }
    );

    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error("expected rejection");
    expect(result.reasonCode).toBe("policy_not_found");
  });
});
