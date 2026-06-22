import { describe, expect, it, vi } from "vitest";
import { handlePioToolCall, pioMcpToolList } from "../hermes/mcp-tools";
import type { PioClient } from "../hermes/pio-client";

describe("pioMcpToolList", () => {
  it("exposes the six real PIO tools with object input schemas", () => {
    const tools = pioMcpToolList();
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [
        "confirm_purchase",
        "get_policy",
        "get_review_queue",
        "purchase_off_session",
        "request_coverage",
        "settle_policy"
      ].sort()
    );
    for (const tool of tools) {
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema.type).toBe("object");
    }
  });
});

describe("handlePioToolCall", () => {
  it("routes a tool call and wraps the result as MCP text content", async () => {
    const client = { settlePolicy: vi.fn(async () => ({ accepted: true, outcome: "payout_requested" })) };

    const result = await handlePioToolCall(client as unknown as PioClient, "settle_policy", { policyId: "p1" });

    expect(client.settlePolicy).toHaveBeenCalledWith("p1");
    expect(result.isError).toBeFalsy();
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toMatchObject({ accepted: true, outcome: "payout_requested" });
  });

  it("returns an MCP error result for an unknown tool instead of throwing", async () => {
    const result = await handlePioToolCall({} as PioClient, "drop_table", {});

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Unknown PIO tool");
  });
});
