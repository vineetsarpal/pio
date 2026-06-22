import { describe, expect, it } from "vitest";
import { riskAssessmentFromMemo, researchRiskAdapters } from "../lib/operator-research-pricing";
import { adjustmentFromScore } from "../lib/premium-pricing";

const memo = {
  riskScore: 0.5,
  evidence: [{ url: "https://x.test/a", title: "A", snippet: "rain likely", retrievedAt: "2026-06-22T00:00:00Z" }],
  factors: ["coastal squalls in season"],
  toolName: "Firecrawl search",
  model: "nemotron"
};

describe("riskAssessmentFromMemo", () => {
  it("maps the memo score into the band and carries citations", () => {
    const a = riskAssessmentFromMemo("rain_event", memo, "2026-06-22T00:00:00Z");
    expect(a.pricingAdjustment).toBeCloseTo(adjustmentFromScore("rain_event", 0.5), 10);
    expect(a.source).toBe("operator_web_research");
    expect(a.score).toBe(50);
    expect(a.citations).toEqual(memo.evidence);
    expect(a.apiCall.toolName).toBe("Firecrawl search");
  });
});

describe("researchRiskAdapters", () => {
  it("returns the same assessment for both rain and flight lookups", async () => {
    const a = riskAssessmentFromMemo("rain_event", memo, "2026-06-22T00:00:00Z");
    const adapters = researchRiskAdapters(a);
    expect(await adapters.weather!.getRainEventRisk({} as never)).toBe(a);
    expect(await adapters.flight!.getFlightDelayRisk({} as never)).toBe(a);
  });
});
