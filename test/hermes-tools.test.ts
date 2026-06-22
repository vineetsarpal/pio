import { describe, expect, it, vi } from "vitest";
import { dispatchPioToolCall, pioTools } from "../hermes/tools";
import type { PioClient } from "../hermes/pio-client";

describe("pioTools", () => {
  it("exposes the buyer and operator tools by name", () => {
    const names = pioTools.map((tool) => tool.function.name).sort();
    expect(names).toEqual(
      [
        "confirm_purchase",
        "get_policy",
        "get_review_queue",
        "purchase_off_session",
        "request_coverage",
        "settle_policy"
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
