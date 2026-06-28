import type { Citation, ProductQuoteInput, ProductRiskAdapters, RiskAssessment } from "./coverage-products";
import { productQuoteId, quoteCoverageProduct, validateProductQuoteInput } from "./coverage-products";
import type { PolicyStore } from "./policy-store";
import type { CoverageProductId, Money, Policy } from "./types";
import { adjustmentFromScore, clampScore } from "./premium-pricing";
import { withProgress, type PricingJob } from "./pricing-job";
import { triggerHermesPricingWebhook } from "./hermes-pricing-webhook";

export type RiskMemo = {
  riskScore: number;
  evidence: Citation[];
  factors?: string[];
  toolName: string;
  model?: string;
};

export function riskAssessmentFromMemo(
  productId: CoverageProductId,
  memo: RiskMemo,
  now: string
): RiskAssessment {
  const score01 = clampScore(memo.riskScore);
  return {
    productId,
    source: "operator_web_research",
    sourceLabel: `Operator web research (${memo.toolName})`,
    apiStatus: "live",
    apiCall: {
      toolName: memo.toolName,
      method: "POST",
      endpoint: "pio://operator/web-research",
      status: "success",
      calledAt: now,
      latencyMs: 0,
      purpose: "Operator-researched risk signal for premium pricing."
    },
    score: Math.round(score01 * 100),
    pricingAdjustment: adjustmentFromScore(productId, memo.riskScore),
    factors: memo.factors ?? [],
    observedMetric: { label: "Operator risk score", value: `${Math.round(score01 * 100)}/100` },
    citations: memo.evidence
  };
}

export function researchRiskAdapters(assessment: RiskAssessment): ProductRiskAdapters {
  return {
    weather: { getRainEventRisk: async () => assessment },
    flight: { getFlightDelayRisk: async () => assessment }
  };
}

/**
 * Default ceiling on concurrently pending research jobs. Each pending job is
 * work the Hermes operator will pick up and spend LLM + web-search budget on,
 * so this caps blast radius from a flood of intake requests. Override with
 * PIO_MAX_PENDING_PRICING_JOBS.
 */
const DEFAULT_MAX_PENDING_PRICING_JOBS = 20;

function maxPendingPricingJobs(): number {
  const raw = Number(process.env.PIO_MAX_PENDING_PRICING_JOBS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_PENDING_PRICING_JOBS;
}

export class PricingQueueFullError extends Error {
  readonly reasonCode = "pricing_queue_full" as const;
  constructor(readonly pending: number, readonly max: number) {
    super(`Pricing queue is at capacity (${pending}/${max} pending). Try again shortly.`);
    this.name = "PricingQueueFullError";
  }
}

export async function createDynamicPricingJob(
  input: ProductQuoteInput,
  { store, now, adapters, maxPending = maxPendingPricingJobs() }:
    { store: PolicyStore; now: string; adapters?: ProductRiskAdapters; maxPending?: number }
): Promise<{ quoteId: string; status: "quote_requested"; baseline: { risk: RiskAssessment; premium: Money } }> {
  validateProductQuoteInput(input, new Date(now));
  const pending = await store.listPendingPricingJobs();
  if (pending.length >= maxPending) {
    throw new PricingQueueFullError(pending.length, maxPending);
  }
  const quoteId = productQuoteId(input);
  const quote = await quoteCoverageProduct(input, adapters, { now: new Date(now) });
  const baseline = { risk: quote.risk, premium: quote.policy.premium };
  let job: PricingJob = { quoteId, productInput: input, status: "pending" as const, createdAt: now, baseline };
  job = withProgress(job, { at: now, source: "pio", step: "weather_api_called",
    detail: `${quote.risk.sourceLabel}: ${quote.risk.observedMetric.label} ${quote.risk.observedMetric.value}` });
  job = withProgress(job, { at: now, source: "pio", step: "baseline_computed",
    detail: `Baseline premium $${baseline.premium.amount}` });
  await store.savePricingJob(job);
  await triggerHermesPricingWebhook(job);
  return { quoteId, status: "quote_requested", baseline };
}

export async function appendJobProgress(
  { quoteId, step, detail, now }: { quoteId: string; step: string; detail?: string; now: string },
  { store }: { store: PolicyStore }
): Promise<{ accepted: true } | { accepted: false; reasonCode: "job_not_found" | "already_priced" }> {
  const job = await store.getPricingJob(quoteId);
  if (!job) return { accepted: false, reasonCode: "job_not_found" };
  if (job.status === "priced") return { accepted: false, reasonCode: "already_priced" };
  await store.savePricingJob(withProgress(job, { at: now, source: "operator", step, detail }));
  return { accepted: true };
}

export async function pricePricingJob(
  { quoteId, memo, now }: { quoteId: string; memo: RiskMemo; now: string },
  { store, adapters }: { store: PolicyStore; adapters?: ProductRiskAdapters }
): Promise<{ accepted: true; policy: Policy } | { accepted: false; reasonCode: "job_not_found" | "already_priced" }> {
  const job = await store.getPricingJob(quoteId);
  if (!job) return { accepted: false, reasonCode: "job_not_found" };
  if (job.status === "priced") return { accepted: false, reasonCode: "already_priced" };

  const assessment = memo.evidence.length > 0
    ? riskAssessmentFromMemo(job.productInput.productId, memo, now)
    : undefined;
  // grounded → research adapter; else reuse the stored baseline risk; else default adapters
  const adapterRisk = assessment ?? job.baseline?.risk;
  const quote = await quoteCoverageProduct(
    job.productInput,
    adapterRisk ? researchRiskAdapters(adapterRisk) : adapters,
    { now: new Date(now) }
  );
  const policy: Policy = {
    ...quote.policy,
    pricingMode: "dynamic",
    pricedBy: assessment ? "operator_research" : "deterministic_fallback",
    riskCitations: assessment?.citations
  };
  const pricedJob = withProgress(
    { ...job, status: "priced", pricedAt: now, premium: policy.premium, citations: assessment?.citations, pricedBy: policy.pricedBy },
    { at: now, source: "pio", step: "priced", detail: `Priced $${policy.premium.amount}${assessment ? ` from ${assessment.citations?.length ?? 0} sources` : " (deterministic fallback)"}` }
  );
  await store.withTransaction(async (tx) => {
    await tx.savePolicy(policy);
    await tx.savePricingJob(pricedJob);
  });
  return { accepted: true, policy };
}
