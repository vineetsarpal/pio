import { describe, expect, it } from "vitest";
import type { RiskAssessment, WeatherPricingApi } from "../lib/coverage-products";
import { DemoFlightStatusPricingApi, quoteCoverageProduct } from "../lib/coverage-products";

const rainRequest = {
  productId: "rain_event" as const,
  customerName: "North Pier Pop-up Market",
  eventName: "Saturday Harbor Market",
  locationName: "Toronto Waterfront",
  latitude: 43.6405,
  longitude: -79.3764,
  eventStart: "2026-06-20T12:00:00-04:00",
  eventEnd: "2026-06-20T18:00:00-04:00",
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
  departureTime: "2026-06-21T17:15:00-04:00",
  arrivalTime: "2026-06-21T19:30:00-07:00",
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
    expect(quote.packet.triggerSummary).toContain("arrival delay exceeds 90 minutes");
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
