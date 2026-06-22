import { describe, expect, it } from "vitest";
import { calculatePremium, estimatePremiumRange } from "../lib/premium-pricing";

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
