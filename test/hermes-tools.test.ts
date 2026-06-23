import { describe, expect, it, vi } from "vitest";
import { dispatchPioToolCall, pioTools } from "../hermes/tools";
import type { PioClient } from "../hermes/pio-client";

describe("pioTools", () => {
  it("exposes the buyer and operator tools by name", () => {
    const names = pioTools.map((tool) => tool.function.name).sort();
    expect(names).toEqual(
      [
        "confirm_dynamic_purchase",
        "confirm_purchase",
        "get_policy",
        "get_review_queue",
        "purchase_off_session",
        "report_progress",
        "request_coverage",
        "request_dynamic_coverage",
        "settle_policy",
        "submit_research_quote",
        "wait_for_pricing_job"
      ].sort()
    );
  });

  it("every tool carries an object JSON schema for its parameters", () => {
    for (const tool of pioTools) {
      expect(tool.type).toBe("function");
      expect(tool.function.parameters.type).toBe("object");
    }
  });
});

it("defines the four new tools tagged with the right scope", () => {
  const byName = Object.fromEntries(pioTools.map((t) => [t.function.name, t]));
  expect(byName["wait_for_pricing_job"].scope).toBe("operator");
  expect(byName["submit_research_quote"].scope).toBe("operator");
  expect(byName["request_dynamic_coverage"].scope).toBe("buyer");
  expect(byName["confirm_dynamic_purchase"].scope).toBe("buyer");
  // every tool has a scope and an object schema
  for (const t of pioTools) {
    expect(["buyer", "operator"]).toContain(t.scope);
    expect(t.function.parameters.type).toBe("object");
  }
});

it("routes the new tool calls to the matching client methods", async () => {
  const client = {
    waitForPricingJob: vi.fn(async () => ({ jobs: [] })),
    submitResearchQuote: vi.fn(async () => ({ accepted: true })),
    requestDynamicCoverage: vi.fn(async () => ({ accepted: true, quoteId: "q" })),
    confirmDynamicPurchase: vi.fn(async () => ({ accepted: true }))
  } as unknown as import("../hermes/pio-client").PioClient;

  await dispatchPioToolCall(client, "wait_for_pricing_job", { since: "2026-06-22T00:00:00Z" });
  await dispatchPioToolCall(client, "submit_research_quote", { quoteId: "q", riskScore: 0.5, evidence: [], toolName: "Firecrawl" });
  await dispatchPioToolCall(client, "request_dynamic_coverage", { productId: "rain_event", customerName: "c" });
  await dispatchPioToolCall(client, "confirm_dynamic_purchase", { agentId: "a", quoteId: "q", idempotencyKey: "i", authorization: "confirm_purchase", maximumPremium: { amount: 1, currency: "USD" } });

  expect((client as any).waitForPricingJob).toHaveBeenCalledWith("2026-06-22T00:00:00Z");
  expect((client as any).submitResearchQuote).toHaveBeenCalledWith("q", { quoteId: "q", riskScore: 0.5, evidence: [], toolName: "Firecrawl" });
  expect((client as any).requestDynamicCoverage).toHaveBeenCalled();
  expect((client as any).confirmDynamicPurchase).toHaveBeenCalled();
});

it("defines report_progress (operator) and routes it", async () => {
  const byName = Object.fromEntries(pioTools.map((t) => [t.function.name, t]));
  expect(byName["report_progress"].scope).toBe("operator");
  const client = { reportProgress: vi.fn(async () => ({ accepted: true })) } as unknown as import("../hermes/pio-client").PioClient;
  await dispatchPioToolCall(client, "report_progress", { quoteId: "q", step: "researching", detail: "d" });
  expect((client as any).reportProgress).toHaveBeenCalledWith("q", "researching", "d");
});

describe("dispatchPioToolCall", () => {
  it("routes settle_policy to the client with the policyId argument", async () => {
    const client = { settlePolicy: vi.fn(async () => ({ accepted: true, outcome: "payout_requested" })) };

    const result = await dispatchPioToolCall(client as unknown as PioClient, "settle_policy", {
      policyId: "pio-pol-2026-0001"
    });

    expect(client.settlePolicy).toHaveBeenCalledWith("pio-pol-2026-0001");
    expect(result).toMatchObject({ accepted: true, outcome: "payout_requested" });
  });

  it("routes request_coverage to the client with the full input", async () => {
    const client = { requestCoverage: vi.fn(async () => ({ accepted: true })) };
    const input = { agentId: "a1", customerName: "X" };

    await dispatchPioToolCall(client as unknown as PioClient, "request_coverage", input);

    expect(client.requestCoverage).toHaveBeenCalledWith(input);
  });

  it("throws on an unknown tool name", async () => {
    await expect(
      dispatchPioToolCall({} as PioClient, "drop_table", {})
    ).rejects.toThrow("Unknown PIO tool: drop_table");
  });
});
