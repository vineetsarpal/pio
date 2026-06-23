import { describe, expect, it } from "vitest";
import { pricingFeedView, quoteStatusView } from "../lib/ops-feed";
import type { PricingJob } from "../lib/pricing-job";

const input = { productId: "rain_event", customerName: "C", eventName: "Harbor Market", locationName: "Toronto",
  latitude: 1, longitude: 2, eventStart: "2030-01-01T00:00:00Z", eventEnd: "2030-01-01T06:00:00Z",
  desiredPayout: { amount: 500, currency: "USD" } } as never;

const pending: PricingJob = { quoteId: "p1", productInput: input, status: "pending", createdAt: "2026-06-22T00:00:01Z",
  progress: [{ at: "t", source: "pio", step: "weather_api_called", detail: "Open-Meteo" }] };
const priced: PricingJob = { quoteId: "p2", productInput: input, status: "priced", createdAt: "2026-06-22T00:00:02Z",
  premium: { amount: 64, currency: "USD" }, citations: [{ url: "u", title: "t", snippet: "s", retrievedAt: "r" }], pricedBy: "operator_research",
  progress: [{ at: "t", source: "pio", step: "priced", detail: "Priced $64" }] };

it("quoteStatusView maps pending vs priced", () => {
  expect(quoteStatusView(undefined)).toMatchObject({ found: false });
  expect(quoteStatusView(pending)).toMatchObject({ found: true, status: "quote_requested" });
  expect(quoteStatusView(priced)).toMatchObject({ found: true, status: "policy_quoted", premium: { amount: 64, currency: "USD" } });
  expect(quoteStatusView(priced).citations?.length).toBe(1);
});

it("pricingFeedView partitions and summarizes", () => {
  const view = pricingFeedView([priced, pending]);
  expect(view.pending.map((r) => r.quoteId)).toEqual(["p1"]);
  expect(view.recentlyPriced.map((r) => r.quoteId)).toEqual(["p2"]);
  expect(view.pending[0].latestProgress).toBe("weather_api_called");
  expect(view.recentlyPriced[0]).toMatchObject({ premium: { amount: 64, currency: "USD" }, citationCount: 1, eventName: "Harbor Market" });
});
