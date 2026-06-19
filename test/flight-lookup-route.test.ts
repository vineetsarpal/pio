import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/flights/lookup/route";

const originalFetch = globalThis.fetch;
const originalKey = process.env.AERODATABOX_RAPIDAPI_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.AERODATABOX_RAPIDAPI_KEY;
  else process.env.AERODATABOX_RAPIDAPI_KEY = originalKey;
  vi.restoreAllMocks();
});

describe("GET /api/flights/lookup", () => {
  it("calls the specific-date endpoint with server-only RapidAPI headers", async () => {
    process.env.AERODATABOX_RAPIDAPI_KEY = "rapid-test-key";
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify([
          {
            number: "AC101",
            airline: { name: "Air Canada" },
            departure: {
              airport: { iata: "YYZ", name: "Toronto Pearson" },
              scheduledTime: { local: "2026-06-21T17:15:00-04:00" }
            },
            arrival: {
              airport: { iata: "YVR", name: "Vancouver International" },
              scheduledTime: { local: "2026-06-21T19:30:00-07:00" }
            }
          }
        ]),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const response = await GET(
      new Request("https://pio.test/api/flights/lookup?flightNumber=ac%20101&date=2026-06-21")
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      results: [{ flightNumber: "AC101", originAirport: "YYZ", destinationAirport: "YVR" }]
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toContain("/flights/number/AC101/2026-06-21?dateLocalRole=Departure");
    expect(init.headers).toMatchObject({
      "X-RapidAPI-Key": "rapid-test-key",
      "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com"
    });
  });

  it("returns a configuration error without calling upstream when the key is missing", async () => {
    delete process.env.AERODATABOX_RAPIDAPI_KEY;
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const response = await GET(
      new Request("https://pio.test/api/flights/lookup?flightNumber=AC101&date=2026-06-21")
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ results: [], message: "AeroDataBox is not configured." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid lookup parameters", async () => {
    process.env.AERODATABOX_RAPIDAPI_KEY = "rapid-test-key";
    const response = await GET(new Request("https://pio.test/api/flights/lookup?flightNumber=?&date=tomorrow"));
    expect(response.status).toBe(400);
  });
});
