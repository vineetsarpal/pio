import { describe, expect, it } from "vitest";
import { parseNominatimReverse, parseNominatimSearch } from "../lib/geocode";

describe("parseNominatimSearch", () => {
  it("maps lat/lon/display_name and coerces numbers", () => {
    const json = [{ lat: "43.64", lon: "-79.38", display_name: "Toronto Waterfront, Toronto" }];
    expect(parseNominatimSearch(json)).toEqual([
      { lat: 43.64, lng: -79.38, label: "Toronto Waterfront, Toronto" }
    ]);
  });

  it("skips malformed entries and returns [] for non-arrays", () => {
    const json = [{ lat: "x", lon: "1", display_name: "bad" }, { lat: "2", lon: "3" }];
    expect(parseNominatimSearch(json)).toEqual([]);
    expect(parseNominatimSearch(null)).toEqual([]);
    expect(parseNominatimSearch({})).toEqual([]);
  });
});

describe("parseNominatimReverse", () => {
  it("returns the display_name label when present", () => {
    expect(parseNominatimReverse({ display_name: "Toronto Waterfront" })).toEqual({ label: "Toronto Waterfront" });
  });

  it("returns undefined when display_name is missing or the payload is invalid", () => {
    expect(parseNominatimReverse({ error: "Unable to geocode" })).toBeUndefined();
    expect(parseNominatimReverse(null)).toBeUndefined();
  });
});
