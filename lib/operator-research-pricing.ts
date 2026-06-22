import type { Citation, ProductQuoteInput, ProductRiskAdapters, RiskAssessment } from "./coverage-products";
import { productQuoteId, quoteCoverageProduct, validateProductQuoteInput } from "./coverage-products";
import type { PolicyStore } from "./policy-store";
import type { CoverageProductId, Policy } from "./types";
import { adjustmentFromScore, clampScore } from "./premium-pricing";

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

export async function createDynamicPricingJob(
  input: ProductQuoteInput,
  { store, now }: { store: PolicyStore; now: string }
): Promise<{ quoteId: string; status: "quote_requested" }> {
  validateProductQuoteInput(input, new Date(now));
  const quoteId = productQuoteId(input);
  await store.savePricingJob({ quoteId, productInput: input, status: "pending", createdAt: now });
  return { quoteId, status: "quote_requested" };
}

export async function pricePricingJob(
  { quoteId, memo, now }: { quoteId: string; memo: RiskMemo; now: string },
  { store }: { store: PolicyStore }
): Promise<{ accepted: true; policy: Policy } | { accepted: false; reasonCode: "job_not_found" | "already_priced" }> {
  const job = await store.getPricingJob(quoteId);
  if (!job) return { accepted: false, reasonCode: "job_not_found" };
  if (job.status === "priced") return { accepted: false, reasonCode: "already_priced" };

  // Compute the research assessment once; empty evidence fails closed to the
  // default deterministic adapters (Open-Meteo / AeroDataBox).
  const assessment = memo.evidence.length > 0
    ? riskAssessmentFromMemo(job.productInput.productId, memo, now)
    : undefined;
  const quote = await quoteCoverageProduct(
    job.productInput,
    assessment ? researchRiskAdapters(assessment) : undefined,
    { now: new Date(now) }
  );

  const policy: Policy = {
    ...quote.policy,
    pricingMode: "dynamic",
    pricedBy: assessment ? "operator_research" : "deterministic_fallback",
    riskCitations: assessment?.citations
  };

  await store.withTransaction(async (tx) => {
    await tx.savePolicy(policy);
    await tx.savePricingJob({ ...job, status: "priced", pricedAt: now });
  });
  return { accepted: true, policy };
}
