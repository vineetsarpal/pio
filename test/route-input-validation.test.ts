import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentOffSessionPurchaseBodySchema,
  parseJsonBody
} from "../lib/http-schemas";

// Each route resolves its durable store through the factory; a malformed body
// must be rejected BEFORE any store or Stripe call, so an in-memory stub is
// enough (and most cases never reach it).
const hoisted = vi.hoisted(() => ({ storeRef: {} as { current?: unknown } }));
vi.mock("../lib/policy-store-factory", () => ({
  getPolicyStore: () => hoisted.storeRef.current
}));

import { POST as quote } from "../app/api/quote/route";
import { POST as productQuote } from "../app/api/products/quote/route";
import { POST as createCheckout } from "../app/api/stripe/create-checkout/route";
import { POST as agentPurchase } from "../app/api/agent/purchase/route";
import { GET as reverseGeocode } from "../app/api/geocode/reverse/route";
import { InMemoryPolicyStore } from "../lib/policy-store";

beforeEach(() => {
  hoisted.storeRef.current = new InMemoryPolicyStore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

describe("parseJsonBody", () => {
  it("rejects a body that is not valid JSON", async () => {
    const result = await parseJsonBody(
      jsonRequest("https://pio.test/x", "{ not json"),
      agentOffSessionPurchaseBodySchema
    );
    expect(result).toMatchObject({ ok: false });
  });

  it("reports the offending field path on a schema violation", async () => {
    const result = await parseJsonBody(
      jsonRequest("https://pio.test/x", { idempotencyKey: "", coverageRequest: {} }),
      agentOffSessionPurchaseBodySchema
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("idempotencyKey");
    }
  });
});

describe("POST /api/quote input validation", () => {
  it("returns 400 when desiredPayout is missing", async () => {
    const response = await quote(
      jsonRequest("https://pio.test/api/quote", {
        customerName: "Acme",
        eventName: "Market",
        locationName: "Toronto",
        latitude: 43.6,
        longitude: -79.3,
        eventStart: "2027-06-19T12:00:00-04:00",
        eventEnd: "2027-06-19T18:00:00-04:00"
      })
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
  });

  it("returns 400 when latitude is a string instead of a number", async () => {
    const response = await quote(
      jsonRequest("https://pio.test/api/quote", {
        customerName: "Acme",
        eventName: "Market",
        locationName: "Toronto",
        latitude: "not-a-number",
        longitude: -79.3,
        eventStart: "2027-06-19T12:00:00-04:00",
        eventEnd: "2027-06-19T18:00:00-04:00",
        desiredPayout: { amount: 500, currency: "USD" }
      })
    );
    expect(response.status).toBe(400);
  });
});

describe("POST /api/products/quote input validation", () => {
  it("returns 400 invalid_request for an unknown productId", async () => {
    const response = await productQuote(
      jsonRequest("https://pio.test/api/products/quote", {
        productId: "earthquake",
        customerName: "Acme"
      })
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      reasonCode: "invalid_request"
    });
  });

  it("returns 400 invalid_request when a flight payload omits the airline", async () => {
    const response = await productQuote(
      jsonRequest("https://pio.test/api/products/quote", {
        productId: "flight_delay",
        customerName: "Avery Chen",
        passengerName: "Avery Chen",
        flightNumber: "AC101",
        originAirport: "YYZ",
        destinationAirport: "YVR",
        departureTime: "2027-06-21T17:15",
        arrivalTime: "2027-06-21T19:30",
        desiredPayout: { amount: 400, currency: "USD" }
      })
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      reasonCode: "invalid_request"
    });
  });
});

describe("POST /api/stripe/create-checkout input validation", () => {
  it("returns 400 invalid_request for a malformed body", async () => {
    const response = await createCheckout(
      jsonRequest("https://pio.test/api/stripe/create-checkout", {
        productId: "rain_event"
        // missing every other required field
      })
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      reasonCode: "invalid_request",
      demoMode: true
    });
  });
});

describe("GET /api/geocode/reverse input validation", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns 400 with label null and does not call Nominatim for non-numeric lat/lon", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await reverseGeocode(
      new Request("https://pio.test/api/geocode/reverse?lat=abc&lon=-79.38")
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ label: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 for an out-of-range latitude", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await reverseGeocode(
      new Request("https://pio.test/api/geocode/reverse?lat=120&lon=-79.38")
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ label: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/agent/purchase input validation", () => {
  const seedEnv = {
    PIO_AGENT_SEED_KEY: process.env.PIO_AGENT_SEED_KEY,
    PIO_SEED_STRIPE_CUSTOMER: process.env.PIO_SEED_STRIPE_CUSTOMER,
    PIO_SEED_STRIPE_PAYMENT_METHOD: process.env.PIO_SEED_STRIPE_PAYMENT_METHOD
  };

  beforeEach(() => {
    process.env.PIO_AGENT_SEED_KEY = "pio_seed_key_123";
    process.env.PIO_SEED_STRIPE_CUSTOMER = "cus_test_seed";
    process.env.PIO_SEED_STRIPE_PAYMENT_METHOD = "pm_card_visa";
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(seedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("returns 400 invalid_request when coverageRequest is absent", async () => {
    const response = await agentPurchase(
      jsonRequest(
        "https://pio.test/api/agent/purchase",
        { idempotencyKey: "headless-bad-1" },
        { authorization: "Bearer pio_seed_key_123" }
      )
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      reasonCode: "invalid_request"
    });
  });

  it("returns 400 invalid_request when idempotencyKey is empty", async () => {
    const response = await agentPurchase(
      jsonRequest(
        "https://pio.test/api/agent/purchase",
        {
          idempotencyKey: "",
          coverageRequest: {
            customerName: "Acme",
            eventName: "Market",
            locationName: "Toronto",
            latitude: 43.6,
            longitude: -79.3,
            eventStart: "2027-06-19T12:00:00-04:00",
            eventEnd: "2027-06-19T18:00:00-04:00",
            desiredPayout: { amount: 500, currency: "USD" }
          }
        },
        { authorization: "Bearer pio_seed_key_123" }
      )
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      reasonCode: "invalid_request"
    });
  });
});
