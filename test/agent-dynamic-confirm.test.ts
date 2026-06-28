import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleDynamicPurchaseConfirmation, AgentPurchaseConfirmationStore } from "@/lib/agent-coverage";
import { InMemoryPolicyStore } from "@/lib/policy-store";
import { createDynamicPricingJob, pricePricingJob } from "@/lib/operator-research-pricing";
import { DemoWeatherPricingApi } from "@/lib/coverage-products";
import { SimulatedHermesStripeSkillsAdapter } from "./fakes";
import { POST as confirmDynamicPurchase } from "../app/api/agent/confirm-dynamic-purchase/route";

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
  const { quoteId } = await createDynamicPricingJob(productInput, { store, now: NOW, adapters: { weather: new DemoWeatherPricingApi() } });
  await pricePricingJob(
    { quoteId, memo, now: NOW },
    { store, adapters: { weather: new DemoWeatherPricingApi() } }
  );
  return quoteId;
}

const routeEnv = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  PIO_AGENT_SEED_KEY: process.env.PIO_AGENT_SEED_KEY,
  PIO_SEED_STRIPE_CUSTOMER: process.env.PIO_SEED_STRIPE_CUSTOMER,
  PIO_SEED_STRIPE_PAYMENT_METHOD: process.env.PIO_SEED_STRIPE_PAYMENT_METHOD,
  PIO_POLICY_STATUS_TOKEN_SECRET: process.env.PIO_POLICY_STATUS_TOKEN_SECRET
};

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_demo";
  process.env.NEXT_PUBLIC_APP_URL = "https://pio.test";
  process.env.PIO_AGENT_SEED_KEY = "pio_seed_key_123";
  process.env.PIO_SEED_STRIPE_CUSTOMER = "cus_test_seed";
  process.env.PIO_SEED_STRIPE_PAYMENT_METHOD = "pm_card_visa";
  process.env.PIO_POLICY_STATUS_TOKEN_SECRET = "test-status-secret";
});

afterEach(() => {
  for (const [key, value] of Object.entries(routeEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("confirm-dynamic-purchase route", () => {
  it("returns 400 with invalid_request when body is malformed (missing quoteId)", async () => {
    const request = new Request("https://pio.test/api/agent/confirm-dynamic-purchase", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer pio_seed_key_123"
      },
      body: JSON.stringify({
        agentId: "agent-test-route",
        // quoteId intentionally omitted
        idempotencyKey: "idem-route-bad-1",
        authorization: "confirm_purchase",
        maximumPremium: { amount: 100, currency: "USD" }
      })
    });

    const response = await confirmDynamicPurchase(request);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      reasonCode: "invalid_request"
    });
  });

  it("returns 400 with invalid_request when maximumPremium currency is non-USD", async () => {
    const request = new Request("https://pio.test/api/agent/confirm-dynamic-purchase", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer pio_seed_key_123"
      },
      body: JSON.stringify({
        agentId: "agent-test-route",
        quoteId: "some-quote-id",
        idempotencyKey: "idem-route-bad-2",
        authorization: "confirm_purchase",
        maximumPremium: { amount: 100, currency: "EUR" }
      })
    });

    const response = await confirmDynamicPurchase(request);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      reasonCode: "invalid_request"
    });
  });
});

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

  it("passes a signed policy status token into dynamic checkout creation", async () => {
    const store = new InMemoryPolicyStore();
    const quoteId = await seedPricedPolicy(store);
    const storedPolicy = await store.getPolicy(quoteId);
    if (!storedPolicy) throw new Error("Expected stored policy");

    let capturedStatusToken: string | undefined;
    const payments = {
      mode: "stripe_test_mode" as const,
      async createCustomer(name: string) {
        return { id: "cus_test_pio_0001", name };
      },
      async createCheckout(
        policy: typeof storedPolicy,
        _customer: { id: string; name: string },
        options?: { statusToken?: string }
      ) {
        capturedStatusToken = options?.statusToken;
        return {
          id: "cs_test_pio_premium_0001",
          url: "https://checkout.stripe.com/c/pay/cs_test_pio_premium_0001",
          premium: policy.premium,
          mode: "stripe_test_mode" as const
        };
      }
    };

    const result = await handleDynamicPurchaseConfirmation(
      {
        agentId: "agent-test-token",
        quoteId,
        idempotencyKey: "idem-dynamic-token",
        authorization: "confirm_purchase",
        maximumPremium: { amount: storedPolicy.premium.amount + 100, currency: "USD" }
      },
      { store, payments }
    );

    expect(result.accepted).toBe(true);
    expect(capturedStatusToken).toMatch(/^\d+\.[0-9a-f]+$/);
  });

  it("rejects with premium_cap_exceeded when maximumPremium < stored premium", async () => {
    const store = new InMemoryPolicyStore();
    const quoteId = await seedPricedPolicy(store);
    const storedPolicy = await store.getPolicy(quoteId);
    if (!storedPolicy) throw new Error("Expected stored policy");

    expect(storedPolicy.premium.amount).toBeGreaterThan(0);

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
