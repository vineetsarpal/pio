import { describe, expect, it } from "vitest";
import { riskAssessmentFromMemo, researchRiskAdapters, createDynamicPricingJob } from "../lib/operator-research-pricing";
import { InMemoryPolicyStore } from "../lib/policy-store";
import { CoverageQuoteValidationError } from "../lib/coverage-products";
import { adjustmentFromScore } from "../lib/premium-pricing";

const memo = {
  riskScore: 0.5,
  evidence: [{ url: "https://x.test/a", title: "A", snippet: "rain likely", retrievedAt: "2026-06-22T00:00:00Z" }],
  factors: ["coastal squalls in season"],
  toolName: "Firecrawl search",
  model: "nemotron"
};

describe("riskAssessmentFromMemo", () => {
  it("maps the memo score into the band and carries citations", () => {
    const a = riskAssessmentFromMemo("rain_event", memo, "2026-06-22T00:00:00Z");
    expect(a.pricingAdjustment).toBeCloseTo(adjustmentFromScore("rain_event", 0.5), 10);
    expect(a.source).toBe("operator_web_research");
    expect(a.score).toBe(50);
    expect(a.citations).toEqual(memo.evidence);
    expect(a.apiCall.toolName).toBe("Firecrawl search");
  });
});

describe("researchRiskAdapters", () => {
  it("returns the same assessment for both rain and flight lookups", async () => {
    const a = riskAssessmentFromMemo("rain_event", memo, "2026-06-22T00:00:00Z");
    const adapters = researchRiskAdapters(a);
    expect(await adapters.weather!.getRainEventRisk({} as never)).toBe(a);
    expect(await adapters.flight!.getFlightDelayRisk({} as never)).toBe(a);
  });
});

it("createDynamicPricingJob persists a pending job and returns the stable quoteId", async () => {
  const store = new InMemoryPolicyStore();
  const input = { productId: "rain_event", customerName: "C", eventName: "E", locationName: "L",
    latitude: 1, longitude: 2, eventStart: "2030-01-01T00:00:00Z", eventEnd: "2030-01-01T06:00:00Z",
    desiredPayout: { amount: 500, currency: "USD" } } as never;
  const res = await createDynamicPricingJob(input, { store, now: "2026-06-22T00:00:00Z" });
  expect(res.status).toBe("quote_requested");
  const job = await store.getPricingJob(res.quoteId);
  expect(job?.status).toBe("pending");
});

it("createDynamicPricingJob rejects an invalid window", async () => {
  const store = new InMemoryPolicyStore();
  const input = { productId: "rain_event", customerName: "C", eventName: "E", locationName: "L",
    latitude: 1, longitude: 2, eventStart: "2020-01-01T06:00:00Z", eventEnd: "2020-01-01T00:00:00Z",
    desiredPayout: { amount: 500, currency: "USD" } } as never;
  await expect(createDynamicPricingJob(input, { store, now: "2026-06-22T00:00:00Z" })).rejects.toThrow(CoverageQuoteValidationError);
});

import { pricePricingJob } from "../lib/operator-research-pricing";

async function seedJob(store: InMemoryPolicyStore) {
  const input = { productId: "rain_event", customerName: "C", eventName: "E", locationName: "L",
    latitude: 1, longitude: 2, eventStart: "2030-01-01T00:00:00Z", eventEnd: "2030-01-01T06:00:00Z",
    desiredPayout: { amount: 500, currency: "USD" } } as never;
  return createDynamicPricingJob(input, { store, now: "2026-06-22T00:00:00Z" });
}

it("prices a job from a grounded memo within the band and persists the policy", async () => {
  const store = new InMemoryPolicyStore();
  const { quoteId } = await seedJob(store);
  const res = await pricePricingJob({ quoteId, now: "2026-06-22T00:01:00Z", memo: {
    riskScore: 0.5, evidence: [{ url: "https://x.test", title: "T", snippet: "s", retrievedAt: "2026-06-22T00:00:30Z" }],
    toolName: "Firecrawl search"
  } }, { store });
  expect(res.accepted).toBe(true);
  const policy = await store.getPolicy(quoteId);
  expect(policy?.status).toBe("policy_quoted");
  expect(policy?.pricedBy).toBe("operator_research");
  expect(policy?.riskCitations?.length).toBe(1);
  expect((await store.getPricingJob(quoteId))?.status).toBe("priced");
});

it("fails closed to the deterministic adapter when evidence is empty", async () => {
  const store = new InMemoryPolicyStore();
  const { quoteId } = await seedJob(store);
  const res = await pricePricingJob({ quoteId, now: "2026-06-22T00:01:00Z", memo: {
    riskScore: 0.9, evidence: [], toolName: "Firecrawl search"
  } }, { store });
  expect(res.accepted).toBe(true);
  expect((await store.getPolicy(quoteId))?.pricedBy).toBe("deterministic_fallback");
});

it("rejects an unknown or already-priced job", async () => {
  const store = new InMemoryPolicyStore();
  const missing = await pricePricingJob({ quoteId: "nope", now: "2026-06-22T00:01:00Z", memo: { riskScore: 0.5, evidence: [], toolName: "t" } }, { store });
  expect(missing).toEqual({ accepted: false, reasonCode: "job_not_found" });
});
