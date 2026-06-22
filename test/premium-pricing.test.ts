import { describe, expect, it } from "vitest";
import { calculatePremium, estimatePremiumRange, adjustmentFromScore, clampScore } from "../lib/premium-pricing";

describe("premium pricing", () => {
  it("estimates the rain premium range from the same calculation used by quoting", () => {
    const range = estimatePremiumRange({
      productId: "rain_event",
      coverageAmount: 500,
      deductibleAmount: 0,
      durationHours: 1
    });

    expect(range).toEqual({
      minimum: { amount: 33, currency: "USD" },
      maximum: { amount: 73, currency: "USD" }
    });
    expect(range?.minimum).toEqual(calculatePremium("rain_event", 500, 0.03, 1));
    expect(range?.maximum).toEqual(calculatePremium("rain_event", 500, 0.11, 1));
  });

  it("applies the deductible before estimating the range", () => {
    expect(
      estimatePremiumRange({
        productId: "rain_event",
        coverageAmount: 500,
        deductibleAmount: 100,
        durationHours: 1
      })
    ).toEqual({
      minimum: { amount: 27, currency: "USD" },
      maximum: { amount: 59, currency: "USD" }
    });
  });

  it("does not estimate invalid terms", () => {
    expect(
      estimatePremiumRange({
        productId: "rain_event",
        coverageAmount: 500,
        deductibleAmount: 500,
        durationHours: 1
      })
    ).toBeUndefined();
  });
});

describe("adjustmentFromScore", () => {
  it("clamps scores into [0,1]", () => {
    expect(clampScore(-2)).toBe(0);
    expect(clampScore(5)).toBe(1);
    expect(clampScore(0.4)).toBe(0.4);
    expect(clampScore(Number.NaN)).toBe(0);
  });

  it("maps score 0 to the band minimum and 1 to the band maximum", () => {
    // rain_event band: min 0.03, max 0.11
    expect(adjustmentFromScore("rain_event", 0)).toBeCloseTo(0.03, 10);
    expect(adjustmentFromScore("rain_event", 1)).toBeCloseTo(0.11, 10);
    expect(adjustmentFromScore("rain_event", 0.5)).toBeCloseTo(0.07, 10);
  });

  it("never exceeds the band even for out-of-range scores", () => {
    expect(adjustmentFromScore("flight_delay", 99)).toBeCloseTo(0.09625, 10);
    expect(adjustmentFromScore("flight_delay", -1)).toBeCloseTo(0.031, 10);
  });
});
