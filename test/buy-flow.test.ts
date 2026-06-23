import { describe, expect, it } from "vitest";
import { dynamicQuoteReducer } from "../components/buy-flow";

it("idle → intake on requested, carrying baseline", () => {
  const s = dynamicQuoteReducer({ phase: "idle" }, { type: "requested", quoteId: "q", baseline: { premium: { amount: 60, currency: "USD" } } });
  expect(s).toMatchObject({ phase: "intake", quoteId: "q", baseline: { premium: { amount: 60, currency: "USD" } }, progress: [] });
});

it("intake stays intake while pending, advances to priced when status says so", () => {
  const intake = dynamicQuoteReducer({ phase: "idle" }, { type: "requested", quoteId: "q", baseline: { premium: { amount: 60, currency: "USD" } } });
  const still = dynamicQuoteReducer(intake, { type: "statusPolled", status: { found: true, status: "quote_requested", progress: [{ at: "t", source: "pio", step: "weather_api_called" }] } as never });
  expect(still.phase).toBe("intake");
  expect((still as any).progress.length).toBe(1);
  const priced = dynamicQuoteReducer(still, { type: "statusPolled", status: { found: true, status: "policy_quoted", premium: { amount: 64, currency: "USD" }, citations: [{ url: "u", title: "t", snippet: "s", retrievedAt: "r" }], progress: [] } as never });
  expect(priced).toMatchObject({ phase: "priced", premium: { amount: 64, currency: "USD" } });
  expect((priced as any).citations.length).toBe(1);
});

it("failed → error", () => {
  expect(dynamicQuoteReducer({ phase: "idle" }, { type: "failed", message: "boom" })).toEqual({ phase: "error", message: "boom" });
});

it("reset from any non-idle state returns idle", () => {
  const intake = dynamicQuoteReducer({ phase: "idle" }, { type: "requested", quoteId: "q" });
  expect(dynamicQuoteReducer(intake, { type: "reset" })).toEqual({ phase: "idle" });

  const priced = { phase: "priced" as const, quoteId: "q", premium: { amount: 64, currency: "USD" as const }, citations: [], progress: [] };
  expect(dynamicQuoteReducer(priced, { type: "reset" })).toEqual({ phase: "idle" });

  const error = { phase: "error" as const, message: "boom" };
  expect(dynamicQuoteReducer(error, { type: "reset" })).toEqual({ phase: "idle" });
});
