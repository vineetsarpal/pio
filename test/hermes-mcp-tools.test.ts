import { describe, expect, it, vi } from "vitest";
import { activeScopesFromEnv, handlePioToolCall, pioMcpToolList } from "../hermes/mcp-tools";
import type { PioClient } from "../hermes/pio-client";

describe("pioMcpToolList", () => {
  it("lists all ten tools when no scope filter is given", () => {
    expect(pioMcpToolList().map((t) => t.name).sort()).toEqual([
      "confirm_dynamic_purchase", "confirm_purchase", "get_policy", "get_review_queue",
      "purchase_off_session", "request_coverage", "request_dynamic_coverage",
      "settle_policy", "submit_research_quote", "wait_for_pricing_job"
    ].sort());
    for (const tool of pioMcpToolList()) {
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("lists only operator tools for the operator scope", () => {
    expect(pioMcpToolList(["operator"]).map((t) => t.name).sort()).toEqual(
      ["get_review_queue", "settle_policy", "submit_research_quote", "wait_for_pricing_job"].sort()
    );
  });

  it("lists only buyer tools for the buyer scope", () => {
    expect(pioMcpToolList(["buyer"]).map((t) => t.name).sort()).toEqual(
      ["confirm_dynamic_purchase", "confirm_purchase", "get_policy", "purchase_off_session",
       "request_coverage", "request_dynamic_coverage"].sort()
    );
  });
});

describe("activeScopesFromEnv", () => {
  it("derives operator scope from the operator key only", () => {
    expect(activeScopesFromEnv({ PIO_OPERATOR_KEY: "x" })).toEqual(["operator"]);
  });
  it("derives buyer scope from the agent key only", () => {
    expect(activeScopesFromEnv({ PIO_AGENT_SEED_KEY: "x" })).toEqual(["buyer"]);
  });
  it("defaults to both scopes when neither key is set", () => {
    expect(activeScopesFromEnv({}).sort()).toEqual(["buyer", "operator"]);
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
