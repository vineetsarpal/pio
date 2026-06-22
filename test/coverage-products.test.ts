import { describe, expect, it } from "vitest";
import type { RiskAssessment, WeatherPricingApi } from "../lib/coverage-products";
import {
  AeroDataBoxFlightStatusPricingApi,
  CoverageQuoteValidationError,
  DemoFlightStatusPricingApi,
  quoteCoverageProduct
} from "../lib/coverage-products";

const rainRequest = {
  productId: "rain_event" as const,
  customerName: "North Pier Pop-up Market",
  eventName: "Saturday Harbor Market",
  locationName: "Toronto Waterfront",
  latitude: 43.6405,
  longitude: -79.3764,
  eventStart: "2027-06-19T12:00:00-04:00",
  eventEnd: "2027-06-19T18:00:00-04:00",
  desiredPayout: { amount: 500, currency: "USD" as const },
  maximumPremium: { amount: 120, currency: "USD" as const }
};

const flightRequest = {
  productId: "flight_delay" as const,
  customerName: "Avery Chen",
  passengerName: "Avery Chen",
  airline: "Air Canada",
  flightNumber: "AC101",
  originAirport: "YYZ",
  destinationAirport: "YVR",
  departureTime: "2027-06-21T17:15:00-04:00",
  arrivalTime: "2027-06-21T19:30:00-07:00",
  desiredPayout: { amount: 400, currency: "USD" as const },
  maximumPremium: { amount: 100, currency: "USD" as const }
};

describe("quoteCoverageProduct", () => {
  it("prices rain event coverage from weather risk adapter output", async () => {
    const lowRiskWeather = weatherRisk({ score: 24, pricingAdjustment: 0.032, value: "0.5 mm" });
    const highRiskWeather = weatherRisk({ score: 82, pricingAdjustment: 0.1, value: "7.8 mm" });

    const lowRiskQuote = await quoteCoverageProduct(rainRequest, { weather: lowRiskWeather });
    const highRiskQuote = await quoteCoverageProduct(rainRequest, { weather: highRiskWeather });

    expect(lowRiskQuote.product.id).toBe("rain_event");
    expect(lowRiskQuote.policy.trigger.variable).toBe("rainfall_mm");
    expect(lowRiskQuote.packet.title).toBe("Parametric rain event protection packet");
    expect(highRiskQuote.policy.premium.amount).toBeGreaterThan(lowRiskQuote.policy.premium.amount);
    expect(highRiskQuote.agentNarrative[0]).toContain("called the Test weather API");
    expect(highRiskQuote.risk.apiCall).toMatchObject({
      toolName: "Test weather API",
      method: "SIMULATED",
      status: "simulated"
    });
  });

  it("prices flight delay coverage from route delay risk", async () => {
    const quote = await quoteCoverageProduct(flightRequest, { flight: new DemoFlightStatusPricingApi() });

    expect(quote.product.id).toBe("flight_delay");
    expect(quote.policy.trigger.variable).toBe("arrival_delay_minutes");
    expect(quote.policy.locationName).toBe("YYZ to YVR");
    expect(quote.risk.sourceLabel).toBe("Demo flight status API");
    expect(quote.risk.apiCall).toMatchObject({
      toolName: "Demo flight status API",
      endpoint: "pio://demo-flight-status-api/routes/YYZ-YVR",
      status: "simulated"
    });
    expect(quote.packet.triggerSummary).toBe("Arrival delay exceeds 90 minutes.");
  });

  it("uses a live AeroDataBox itinerary when one matches the selected route", async () => {
    const adapter = new AeroDataBoxFlightStatusPricingApi(async () => [
      {
        id: "ACA101",
        flightNumber: "AC101",
        airline: "Air Canada",
        originAirport: "YYZ",
        originName: "Toronto Pearson",
        destinationAirport: "YVR",
        destinationName: "Vancouver International",
        departureTime: flightRequest.departureTime,
        arrivalTime: flightRequest.arrivalTime,
        status: "Scheduled",
        departureDelayMinutes: 0,
        arrivalDelayMinutes: 0
      }
    ]);

    const quote = await quoteCoverageProduct(flightRequest, { flight: adapter });

    expect(quote.risk.apiStatus).toBe("live");
    expect(quote.risk.sourceLabel).toBe("AeroDataBox flight status API");
    expect(quote.risk.factors[0]).toContain("verified by AeroDataBox");
  });

  it("prices the net payout after applying a deductible", async () => {
    const quoteWithoutDeductible = await quoteCoverageProduct(flightRequest, {
      flight: new DemoFlightStatusPricingApi()
    });
    const quote = await quoteCoverageProduct(
      {
        ...flightRequest,
        deductible: { amount: 100, currency: "USD" }
      },
      { flight: new DemoFlightStatusPricingApi() }
    );

    expect(quote.policy.coverageAmount).toEqual({ amount: 400, currency: "USD" });
    expect(quote.policy.deductible).toEqual({ amount: 100, currency: "USD" });
    expect(quote.policy.payout).toEqual({ amount: 300, currency: "USD" });
    expect(quote.policy.premium.amount).toBeLessThan(quoteWithoutDeductible.policy.premium.amount);
    expect(quote.packet.coverageSummary).toBe("$400");
    expect(quote.packet.deductibleSummary).toBe("$100");
  });

  it("rejects a deductible that is not below the coverage amount", async () => {
    await expect(
      quoteCoverageProduct(
        {
          ...flightRequest,
          deductible: { amount: 400, currency: "USD" }
        },
        { flight: new DemoFlightStatusPricingApi() }
      )
    ).rejects.toThrow("deductible must be less than the coverage amount");
  });

  it("rejects quotes above the customer's maximum premium", async () => {
    await expect(
      quoteCoverageProduct(
        {
          ...flightRequest,
          maximumPremium: { amount: 10, currency: "USD" }
        },
        { flight: new DemoFlightStatusPricingApi() }
      )
    ).rejects.toThrow("exceeds the maximum budget");
  });

  it("includes a future expiry on the quote", async () => {
    const quote = await quoteCoverageProduct(rainRequest, {
      weather: weatherRisk({ score: 24, pricingAdjustment: 0.032, value: "0.5 mm" }),
      // adapters
    }, { now: new Date("2027-06-18T00:00:00.000Z") });

    expect(quote.expiresAt).toBe("2027-06-18T00:15:00.000Z");
  });

  it("rejects a coverage amount outside the supported range with a typed code", async () => {
    await expect(
      quoteCoverageProduct(
        { ...rainRequest, desiredPayout: { amount: 10, currency: "USD" } },
        { weather: weatherRisk({ score: 24, pricingAdjustment: 0.032, value: "0.5 mm" }) }
      )
    ).rejects.toMatchObject({
      name: "CoverageQuoteValidationError",
      reasonCode: "invalid_coverage"
    });
  });

  it("rejects a window whose end is before its start", async () => {
    await expect(
      quoteCoverageProduct(
        { ...rainRequest, eventStart: "2027-06-19T18:00:00-04:00", eventEnd: "2027-06-19T12:00:00-04:00" },
        { weather: weatherRisk({ score: 24, pricingAdjustment: 0.032, value: "0.5 mm" }) }
      )
    ).rejects.toMatchObject({ reasonCode: "invalid_dates" });
  });

  it("rejects a coverage window that has already ended", async () => {
    await expect(
      quoteCoverageProduct(
        rainRequest,
        { weather: weatherRisk({ score: 24, pricingAdjustment: 0.032, value: "0.5 mm" }) },
        { now: new Date("2027-06-20T00:00:00.000Z") }
      )
    ).rejects.toMatchObject({ reasonCode: "expired_quote" });
  });

  it("rejects invalid coordinates for a rain event", async () => {
    await expect(
      quoteCoverageProduct(
        { ...rainRequest, latitude: 999, longitude: -79.3764 },
        { weather: weatherRisk({ score: 24, pricingAdjustment: 0.032, value: "0.5 mm" }) }
      )
    ).rejects.toMatchObject({ reasonCode: "unsupported_location" });
  });
});

import { productQuoteId, DemoWeatherPricingApi } from "../lib/coverage-products";
import type { RainEventQuoteInput } from "../lib/coverage-products";

const rainInput: RainEventQuoteInput = {
  productId: "rain_event",
  customerName: "North Pier Market",
  eventName: "Harbor Market",
  locationName: "Toronto",
  latitude: 43.64,
  longitude: -79.38,
  eventStart: "2030-06-20T12:00:00Z",
  eventEnd: "2030-06-20T18:00:00Z",
  desiredPayout: { amount: 500, currency: "USD" }
};

it("productQuoteId equals the id quoteCoverageProduct assigns", async () => {
  const quote = await quoteCoverageProduct(rainInput, { weather: new DemoWeatherPricingApi() });
  expect(productQuoteId(rainInput)).toBe(quote.policy.id);
});

function weatherRisk({
  score,
  pricingAdjustment,
  value
}: {
  score: number;
  pricingAdjustment: number;
  value: string;
}): WeatherPricingApi {
  return {
    async getRainEventRisk(): Promise<RiskAssessment> {
      return {
        productId: "rain_event",
        source: "pio://test-weather-risk",
        sourceLabel: "Test weather API",
        apiStatus: "demo",
        apiCall: {
          toolName: "Test weather API",
          method: "SIMULATED",
          endpoint: "pio://test-weather-risk",
          status: "simulated",
          calledAt: "2026-06-18T20:00:00.000Z",
          latencyMs: 1,
          purpose: "Inject weather risk for pricing test."
        },
        score,
        pricingAdjustment,
        factors: ["Injected weather risk"],
        observedMetric: {
          label: "Forecast rainfall",
          value
        }
      };
    }
  };
}
