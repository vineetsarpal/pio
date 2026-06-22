import { describe, expect, it } from "vitest";
import { handleDynamicPurchaseConfirmation, AgentPurchaseConfirmationStore } from "@/lib/agent-coverage";
import { InMemoryPolicyStore } from "@/lib/policy-store";
import { createDynamicPricingJob, pricePricingJob } from "@/lib/operator-research-pricing";
import { DemoWeatherPricingApi } from "@/lib/coverage-products";
import { SimulatedHermesStripeSkillsAdapter } from "./fakes";

const NOW = "2026-06-22T00:00:00Z";
const FUTURE_START = "2030-01-01T00:00:00Z";
const FUTURE_END = "2030-01-01T06:00:00Z";

const productInput = {
  productId: "rain_event" as const,
  customerName: "Alice Rain",
  eventName: "Summer Festival",
  locationName: "Miami Beach",
  latitude: 25.79,
  longitude: -80.13,
  eventStart: FUTURE_START,
  eventEnd: FUTURE_END,
  desiredPayout: { amount: 500, currency: "USD" as const }
};

const memo = {
  riskScore: 0.4,
  evidence: [{ url: "https://x.test/a", title: "Rain Risk", snippet: "moderate rain risk", retrievedAt: NOW }],
  factors: ["coastal humidity"],
  toolName: "Firecrawl search"
};

async function seedPricedPolicy(store: InMemoryPolicyStore): Promise<string> {
  const { quoteId } = await createDynamicPricingJob(productInput, { store, now: NOW });
  await pricePricingJob(
    { quoteId, memo, now: NOW },
    { store, adapters: { weather: new DemoWeatherPricingApi() } }
  );
  return quoteId;
}

describe("handleDynamicPurchaseConfirmation", () => {
  it("accepts a confirmation when maximumPremium >= stored premium", async () => {
    const store = new InMemoryPolicyStore();
    const quoteId = await seedPricedPolicy(store);
    const storedPolicy = await store.getPolicy(quoteId);
    if (!storedPolicy) throw new Error("Expected stored policy");

    const payments = new SimulatedHermesStripeSkillsAdapter();
    const result = await handleDynamicPurchaseConfirmation(
      {
        agentId: "agent-test-1",
        quoteId,
        idempotencyKey: "idem-dynamic-1",
        authorization: "confirm_purchase",
        maximumPremium: { amount: storedPolicy.premium.amount + 100, currency: "USD" }
      },
      { store, payments }
    );

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error("Expected accepted");
    expect(result.reasonCode).toBe("checkout_created");
    expect(result.policy.id).toBe(quoteId);
    expect(result.checkout).toBeDefined();
    expect(result.nextAction).toBe("complete_stripe_checkout");
  });

  it("rejects with premium_cap_exceeded when maximumPremium < stored premium", async () => {
    const store = new InMemoryPolicyStore();
    const quoteId = await seedPricedPolicy(store);
    const storedPolicy = await store.getPolicy(quoteId);
    if (!storedPolicy) throw new Error("Expected stored policy");

    const payments = new SimulatedHermesStripeSkillsAdapter();
    const result = await handleDynamicPurchaseConfirmation(
      {
        agentId: "agent-test-2",
        quoteId,
        idempotencyKey: "idem-dynamic-2",
        authorization: "confirm_purchase",
        maximumPremium: { amount: Math.max(0, storedPolicy.premium.amount - 1), currency: "USD" }
      },
      { store, payments }
    );

    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error("Expected rejection");
    expect(result.reasonCode).toBe("premium_cap_exceeded");
  });

  it("rejects with quote_not_priced for an unknown quoteId", async () => {
    const store = new InMemoryPolicyStore();
    const payments = new SimulatedHermesStripeSkillsAdapter();

    const result = await handleDynamicPurchaseConfirmation(
      {
        agentId: "agent-test-3",
        quoteId: "nonexistent-quote-id",
        idempotencyKey: "idem-dynamic-3",
        authorization: "confirm_purchase",
        maximumPremium: { amount: 999, currency: "USD" }
      },
      { store, payments }
    );

    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error("Expected rejection");
    expect(result.reasonCode).toBe("quote_not_priced");
  });

  it("rejects with quote_not_priced for a policy that is not pricingMode=dynamic", async () => {
    const store = new InMemoryPolicyStore();
    // Save a static policy (no pricingMode set)
    const staticPolicy = {
      id: "static-quote-id",
      certificateId: "cert-static",
      customerName: "Bob",
      eventName: "Event",
      locationName: "Somewhere",
      premium: { amount: 50, currency: "USD" as const },
      payout: { amount: 500, currency: "USD" as const },
      trigger: { variable: "rainfall_mm" as const, operator: ">" as const, threshold: 10, aggregation: "sum" as const, window: { start: FUTURE_START, end: FUTURE_END } },
      weatherOracleSource: "demo_replay" as const,
      status: "policy_quoted" as const
    };
    await store.savePolicy(staticPolicy);
    const payments = new SimulatedHermesStripeSkillsAdapter();

    const result = await handleDynamicPurchaseConfirmation(
      {
        agentId: "agent-test-4",
        quoteId: "static-quote-id",
        idempotencyKey: "idem-dynamic-4",
        authorization: "confirm_purchase",
        maximumPremium: { amount: 999, currency: "USD" }
      },
      { store, payments }
    );

    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error("Expected rejection");
    expect(result.reasonCode).toBe("quote_not_priced");
  });

  it("returns idempotentReplay:true on the second call with the same idempotency key", async () => {
    const store = new InMemoryPolicyStore();
    const quoteId = await seedPricedPolicy(store);
    const storedPolicy = await store.getPolicy(quoteId);
    if (!storedPolicy) throw new Error("Expected stored policy");

    const payments = new SimulatedHermesStripeSkillsAdapter();
    const confirmations = new AgentPurchaseConfirmationStore();
    const confirmInput = {
      agentId: "agent-test-5",
      quoteId,
      idempotencyKey: "idem-dynamic-5",
      authorization: "confirm_purchase",
      maximumPremium: { amount: storedPolicy.premium.amount + 100, currency: "USD" }
    };

    const first = await handleDynamicPurchaseConfirmation(confirmInput, { store, payments, confirmations });
    const second = await handleDynamicPurchaseConfirmation(confirmInput, { store, payments, confirmations });

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    if (!second.accepted) throw new Error("Expected second to be accepted");
    expect(second.idempotentReplay).toBe(true);
  });
});
