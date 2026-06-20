import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/pio/quote/route";

const validRequest = {
  customer: {
    name: "North Pier Pop-up Market",
    email: "ops@example.test"
  },
  location: {
    name: "Toronto Waterfront",
    country: "CA",
    latitude: 43.6405,
    longitude: -79.3764
  },
  coverageWindow: {
    start: "2026-06-21T12:00:00.000Z",
    end: "2026-06-21T18:00:00.000Z"
  },
  rainfallThresholdMm: 10,
  coverageAmount: {
    amount: 1000,
    currency: "USD"
  }
};

function post(body: unknown) {
  return POST(
    new Request("https://pio.test/api/pio/quote", {
      method: "POST",
      body: JSON.stringify(body)
    })
  );
}

describe("POST /api/pio/quote", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-20T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a deterministic quote with explanation and audit event", async () => {
    const response = await post(validRequest);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      reasonCode: "quote_ready",
      quote: {
        quote_id: "qt_pio_3t0xljy",
        premium: { amount: 121, currency: "USD" },
        coverage: {
          amount: { amount: 1000, currency: "USD" },
          window: validRequest.coverageWindow,
          location: validRequest.location,
          rainfallThresholdMm: 10
        },
        triggerCondition: "Pays when observed rainfall is greater than 10 mm between 2026-06-21T12:00:00.000Z and 2026-06-21T18:00:00.000Z at Toronto Waterfront.",
        expiresAt: "2026-06-20T12:15:00.000Z",
        riskMemo: {
          baseRate: 0.035,
          riskMultiplier: 2.2,
          fee: { amount: 44, currency: "USD" }
        },
        auditEvent: {
          actor: "pio_quote_engine",
          action: "quote_generated",
          entity: { type: "quote", id: "qt_pio_3t0xljy" },
          timestamp: "2026-06-20T12:00:00.000Z"
        }
      }
    });
  });

  it("rejects bad coverage dates", async () => {
    const response = await post({
      ...validRequest,
      coverageWindow: { start: "not-a-date", end: "2026-06-21T18:00:00.000Z" }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      reasonCode: "invalid_dates"
    });
  });

  it("rejects unsupported locations", async () => {
    const response = await post({
      ...validRequest,
      location: { ...validRequest.location, country: "GB", latitude: 51.5072, longitude: -0.1276 }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      reasonCode: "unsupported_location"
    });
  });

  it("rejects invalid coverage", async () => {
    const response = await post({
      ...validRequest,
      coverageAmount: { amount: 0, currency: "USD" }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      reasonCode: "invalid_coverage"
    });
  });

  it("rejects expired coverage windows", async () => {
    const response = await post({
      ...validRequest,
      coverageWindow: {
        start: "2026-06-19T12:00:00.000Z",
        end: "2026-06-19T18:00:00.000Z"
      }
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      reasonCode: "expired_quote"
    });
  });
});
