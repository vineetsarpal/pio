import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as searchGET } from "../app/api/geocode/route";
import { GET as reverseGET } from "../app/api/geocode/reverse/route";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("GET /api/geocode", () => {
  it("returns parsed results and calls Nominatim with the User-Agent header", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify([{ lat: "43.64", lon: "-79.38", display_name: "Toronto Waterfront" }]), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const response = await searchGET(new Request("https://pio.test/api/geocode?q=toronto"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [{ lat: 43.64, lng: -79.38, label: "Toronto Waterfront" }]
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("nominatim.openstreetmap.org/search"),
      expect.objectContaining({ headers: { "User-Agent": "pio/1.0 (rain-cover demo)" } })
    );
  });

  it("returns empty results without calling fetch when q is missing", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const response = await searchGET(new Request("https://pio.test/api/geocode"));
    await expect(response.json()).resolves.toEqual({ results: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a 502 with empty results when Nominatim fails", async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 503 })) as typeof fetch;
    const response = await searchGET(new Request("https://pio.test/api/geocode?q=toronto"));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ results: [] });
  });
});

describe("GET /api/geocode/reverse", () => {
  it("returns the label from Nominatim reverse", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ display_name: "Toronto Waterfront, Toronto" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const response = await reverseGET(new Request("https://pio.test/api/geocode/reverse?lat=43.64&lon=-79.38"));
    await expect(response.json()).resolves.toEqual({ label: "Toronto Waterfront, Toronto" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("nominatim.openstreetmap.org/reverse"),
      expect.objectContaining({ headers: { "User-Agent": "pio/1.0 (rain-cover demo)" } })
    );
  });

  it("returns label null when lat/lon are missing", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const response = await reverseGET(new Request("https://pio.test/api/geocode/reverse"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ label: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a 502 with a null label when Nominatim fails", async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 503 })) as typeof fetch;
    const response = await reverseGET(
      new Request("https://pio.test/api/geocode/reverse?lat=43.64&lon=-79.38")
    );
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ label: null });
  });
});
