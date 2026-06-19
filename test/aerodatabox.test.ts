import { describe, expect, it } from "vitest";
import { normalizeFlightNumber, parseAeroDataBoxFlights } from "../lib/aerodatabox";

describe("parseAeroDataBoxFlights", () => {
  it("normalizes flight identity, route, schedule, status, and delays", () => {
    const results = parseAeroDataBoxFlights([
      {
        number: "AC101",
        callSign: "ACA101",
        status: "Arrived",
        airline: { name: "Air Canada" },
        departure: {
          airport: { iata: "YYZ", name: "Toronto Pearson" },
          scheduledTime: { local: "2026-06-21T17:15:00-04:00" },
          actualTime: { local: "2026-06-21T17:25:00-04:00" }
        },
        arrival: {
          airport: { iata: "YVR", name: "Vancouver International" },
          scheduledTime: { local: "2026-06-21T19:30:00-07:00" },
          actualTime: { local: "2026-06-21T20:05:00-07:00" }
        }
      }
    ]);

    expect(results).toEqual([
      {
        id: "ACA101",
        flightNumber: "AC101",
        airline: "Air Canada",
        originAirport: "YYZ",
        originName: "Toronto Pearson",
        destinationAirport: "YVR",
        destinationName: "Vancouver International",
        departureTime: "2026-06-21T17:15:00-04:00",
        arrivalTime: "2026-06-21T19:30:00-07:00",
        status: "Arrived",
        departureDelayMinutes: 10,
        arrivalDelayMinutes: 35
      }
    ]);
  });

  it("skips malformed records", () => {
    expect(parseAeroDataBoxFlights(null)).toEqual([]);
    expect(parseAeroDataBoxFlights([{ number: "AC101" }])).toEqual([]);
  });
});

describe("normalizeFlightNumber", () => {
  it("removes spaces and uppercases valid flight numbers", () => {
    expect(normalizeFlightNumber(" ac 101 ")).toBe("AC101");
    expect(normalizeFlightNumber("?")).toBeUndefined();
  });
});
