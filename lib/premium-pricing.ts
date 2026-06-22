import type { CoverageProductId, Money } from "./types";

type PricingRule = {
  baseRate: number;
  minimumRiskAdjustment: number;
  maximumRiskAdjustment: number;
};

const pricingRules: Record<CoverageProductId, PricingRule> = {
  rain_event: {
    baseRate: 0.034,
    minimumRiskAdjustment: 0.03,
    maximumRiskAdjustment: 0.11
  },
  flight_delay: {
    baseRate: 0.042,
    minimumRiskAdjustment: 0.031,
    maximumRiskAdjustment: 0.09625
  }
};

export function calculatePremium(
  productId: CoverageProductId,
  payout: number,
  riskAdjustment: number,
  durationHours: number
): Money {
  const durationAdjustment = Math.min(durationHours, 12) * 0.0025;
  const raw = payout * (pricingRules[productId].baseRate + riskAdjustment + durationAdjustment);
  return { amount: Math.max(12, Math.round(raw)), currency: "USD" };
}

export function estimatePremiumRange({
  productId,
  coverageAmount,
  deductibleAmount,
  durationHours
}: {
  productId: CoverageProductId;
  coverageAmount: number;
  deductibleAmount: number;
  durationHours: number;
}): { minimum: Money; maximum: Money } | undefined {
  if (
    !Number.isFinite(coverageAmount) ||
    !Number.isFinite(deductibleAmount) ||
    !Number.isFinite(durationHours) ||
    coverageAmount <= 0 ||
    deductibleAmount < 0 ||
    deductibleAmount >= coverageAmount ||
    durationHours <= 0
  ) {
    return undefined;
  }

  const payout = coverageAmount - deductibleAmount;
  const rule = pricingRules[productId];
  return {
    minimum: calculatePremium(productId, payout, rule.minimumRiskAdjustment, durationHours),
    maximum: calculatePremium(productId, payout, rule.maximumRiskAdjustment, durationHours)
  };
}
