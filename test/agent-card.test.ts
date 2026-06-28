import { describe, expect, it } from "vitest";
import { buildAgentCard } from "../lib/agent-card";

const BASE = "https://pio.example";

describe("buildAgentCard", () => {
  it("emits the required A2A top-level fields", () => {
    const card = buildAgentCard(BASE);
    for (const key of [
      "protocolVersion",
      "name",
      "description",
      "version",
      "url",
      "capabilities",
      "defaultInputModes",
      "defaultOutputModes",
      "skills"
    ] as const) {
      expect(card[key], `missing ${key}`).toBeTruthy();
    }
    expect(card.protocolVersion).toBe("0.3.0");
    expect(card.defaultInputModes).toContain("application/json");
  });

  it("exposes exactly the four buyer skills by id", () => {
    const card = buildAgentCard(BASE);
    expect(card.skills.map((s) => s.id).sort()).toEqual(
      ["confirm_dynamic_purchase", "get_policy", "purchase_off_session", "request_dynamic_coverage"].sort()
    );
  });

  it("declares the apiKey security scheme in the x-pio-agent-key header and requires it", () => {
    const card = buildAgentCard(BASE);
    expect(card.securitySchemes.agentKey).toMatchObject({
      type: "apiKey",
      in: "header",
      name: "x-pio-agent-key"
    });
    expect(card.security).toEqual([{ agentKey: [] }]);
  });

  it("builds every url from the passed base, with no hardcoded host", () => {
    const card = buildAgentCard(BASE);
    expect(card.url).toBe(`${BASE}/api/agent`);
    expect(card.provider.url).toBe(BASE);
    const serialized = JSON.stringify(card);
    // Every absolute URL in the card points at the passed base.
    for (const match of serialized.match(/https?:\/\/[^"\s]+/g) ?? []) {
      expect(match.startsWith(BASE)).toBe(true);
    }
  });

  it("normalizes a trailing slash in the base url", () => {
    const card = buildAgentCard(`${BASE}/`);
    expect(card.url).toBe(`${BASE}/api/agent`);
  });
});
