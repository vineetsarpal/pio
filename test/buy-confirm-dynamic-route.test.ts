import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryPolicyStore } from "@/lib/policy-store";
import { createDynamicPricingJob, pricePricingJob } from "@/lib/operator-research-pricing";
import { DemoWeatherPricingApi } from "@/lib/coverage-products";
import { SimulatedHermesStripeSkillsAdapter } from "./fakes";
import { createLiveStripeCheckoutAdapterFromEnv } from "@/lib/stripe-checkout";

/**
 * Route test for POST /api/buy/confirm-dynamic/[quoteId].
 *
 * The browser sends ONLY { maximumPremium }. The route injects the seeded agent
 * identity server-side from env vars — the agent key never travels to the browser.
 */

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

// Shared InMemoryPolicyStore across the test run (populated once per describe block)
let store: InMemoryPolicyStore;
let pricedQuoteId: string;
let storedPremiumAmount: number;

// Mock policy-store-factory so the route uses our in-memory store (avoids DB dependency)
vi.mock("@/lib/policy-store-factory", () => ({
  getPolicyStore: () => store
}));

// Mock stripe-checkout so we return a fake adapter (avoids real Stripe calls)
vi.mock("@/lib/stripe-checkout", () => ({
  createLiveStripeCheckoutAdapterFromEnv: vi.fn(() => new SimulatedHermesStripeSkillsAdapter())
}));

// Lazily import the route after mocks are registered
const { POST: buyConfirmDynamic } = await import("../app/api/buy/confirm-dynamic/[quoteId]/route");

const savedEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  // Snapshot & set env vars that getSeededAgent reads
  for (const key of [
    "PIO_AGENT_SEED_KEY",
    "PIO_SEED_STRIPE_CUSTOMER",
    "PIO_SEED_STRIPE_PAYMENT_METHOD",
    "PIO_POLICY_STATUS_TOKEN_SECRET"
  ]) {
    savedEnv[key] = process.env[key];
  }
  process.env.PIO_AGENT_SEED_KEY = "pio_seed_key_test";
  process.env.PIO_SEED_STRIPE_CUSTOMER = "cus_test_seed";
  process.env.PIO_SEED_STRIPE_PAYMENT_METHOD = "pm_card_visa";
  process.env.PIO_POLICY_STATUS_TOKEN_SECRET = "test-status-secret";

  // Seed a priced dynamic policy so the route can find it
  store = new InMemoryPolicyStore();
  const { quoteId } = await createDynamicPricingJob(productInput, {
    store,
    now: NOW,
    adapters: { weather: new DemoWeatherPricingApi() }
  });
  await pricePricingJob(
    { quoteId, memo, now: NOW },
    { store, adapters: { weather: new DemoWeatherPricingApi() } }
  );
  pricedQuoteId = quoteId;

  const policy = await store.getPolicy(quoteId);
  if (!policy) throw new Error("Expected priced policy in store");
  storedPremiumAmount = policy.premium.amount;
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("POST /api/buy/confirm-dynamic/[quoteId]", () => {
  it("returns 200 + checkout_created + checkout.url when maximumPremium >= stored premium", async () => {
    const maximumPremium = { amount: storedPremiumAmount + 100, currency: "USD" };
    const request = new Request(
      `https://pio.test/api/buy/confirm-dynamic/${pricedQuoteId}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maximumPremium })
      }
    );

    const response = await buyConfirmDynamic(request, {
      params: Promise.resolve({ quoteId: pricedQuoteId })
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.accepted).toBe(true);
    expect(body.reasonCode).toBe("checkout_created");
    expect(body.checkout).toBeDefined();
    expect(typeof body.checkout.url).toBe("string");
    expect(body.checkout.url.length).toBeGreaterThan(0);
  });

  it("returns 422 + premium_cap_exceeded when maximumPremium < stored premium", async () => {
    const capBelowPremium = Math.max(0, storedPremiumAmount - 1);
    const request = new Request(
      `https://pio.test/api/buy/confirm-dynamic/${pricedQuoteId}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maximumPremium: { amount: capBelowPremium, currency: "USD" } })
      }
    );

    const response = await buyConfirmDynamic(request, {
      params: Promise.resolve({ quoteId: pricedQuoteId })
    });

    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.accepted).toBe(false);
    expect(body.reasonCode).toBe("premium_cap_exceeded");
  });

  it("returns 503 + agent_seed_not_configured when seed env vars are missing", async () => {
    delete process.env.PIO_AGENT_SEED_KEY;
    delete process.env.PIO_SEED_STRIPE_CUSTOMER;
    delete process.env.PIO_SEED_STRIPE_PAYMENT_METHOD;

    const request = new Request(
      `https://pio.test/api/buy/confirm-dynamic/${pricedQuoteId}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maximumPremium: { amount: 200, currency: "USD" } })
      }
    );

    const response = await buyConfirmDynamic(request, {
      params: Promise.resolve({ quoteId: pricedQuoteId })
    });

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.accepted).toBe(false);
    expect(body.reasonCode).toBe("agent_seed_not_configured");
  });

  it("returns 503 + stripe_not_configured when Stripe adapter factory throws", async () => {
    vi.mocked(createLiveStripeCheckoutAdapterFromEnv).mockImplementationOnce(() => {
      throw new Error("Stripe API key not configured");
    });

    const request = new Request(
      `https://pio.test/api/buy/confirm-dynamic/${pricedQuoteId}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maximumPremium: { amount: storedPremiumAmount + 100, currency: "USD" } })
      }
    );

    const response = await buyConfirmDynamic(request, {
      params: Promise.resolve({ quoteId: pricedQuoteId })
    });

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.accepted).toBe(false);
    expect(body.reasonCode).toBe("stripe_not_configured");
  });
});
