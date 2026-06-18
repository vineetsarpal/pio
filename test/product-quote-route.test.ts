import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/products/quote/route";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("POST /api/products/quote", () => {
  it("returns a rain event quote with weather API risk and policy packet", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          hourly: {
            time: [
              "2026-06-20T12:00",
              "2026-06-20T13:00",
              "2026-06-20T14:00",
              "2026-06-20T15:00",
              "2026-06-20T16:00",
              "2026-06-20T17:00",
              "2026-06-20T18:00"
            ],
            rain: [0.8, 1.2, 1.1, 1.5, 1.0, 0.7, 0.6]
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as typeof fetch;

    const response = await POST(
      new Request("https://pio.test/api/products/quote", {
        method: "POST",
        body: JSON.stringify({
          productId: "rain_event",
          customerName: "North Pier Pop-up Market",
          eventName: "Saturday Harbor Market",
          locationName: "Toronto Waterfront",
          latitude: 43.6405,
          longitude: -79.3764,
          eventStart: "2026-06-20T12:00:00-04:00",
          eventEnd: "2026-06-20T18:00:00-04:00",
          desiredPayout: { amount: 500, currency: "USD" },
          maximumPremium: { amount: 120, currency: "USD" }
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      reasonCode: "product_quote_ready",
      quote: {
        product: { id: "rain_event" },
        policy: {
          productId: "rain_event",
          trigger: { variable: "rainfall_mm" }
        },
        risk: {
          sourceLabel: "Open-Meteo weather API",
          apiCall: {
            toolName: "Open-Meteo weather API",
            method: "GET",
            status: "success"
          },
          observedMetric: { label: "Forecast rainfall" }
        },
        packet: {
          title: "Parametric rain event protection packet"
        }
      }
    });
  });
});
