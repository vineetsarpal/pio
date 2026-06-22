import type { Citation, ProductRiskAdapters, RiskAssessment } from "./coverage-products";
import type { CoverageProductId } from "./types";
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
