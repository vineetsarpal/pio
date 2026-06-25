import { describe, expect, it } from "vitest";
import { resolvePolicyStatusView } from "@/lib/policy-status-view";

describe("resolvePolicyStatusView", () => {
  it("is active once the policy is activated, regardless of elapsed time", () => {
    expect(resolvePolicyStatusView({ activated: true, elapsedMs: 0, timeoutMs: 20_000 })).toBe("active");
    expect(resolvePolicyStatusView({ activated: true, elapsedMs: 999_999, timeoutMs: 20_000 })).toBe("active");
  });

  it("is verifying while not activated and within the timeout", () => {
    expect(resolvePolicyStatusView({ activated: false, elapsedMs: 1_500, timeoutMs: 20_000 })).toBe("verifying");
  });

  it("is taking_longer when not activated past the timeout", () => {
    expect(resolvePolicyStatusView({ activated: false, elapsedMs: 20_000, timeoutMs: 20_000 })).toBe("taking_longer");
    expect(resolvePolicyStatusView({ activated: false, elapsedMs: 25_000, timeoutMs: 20_000 })).toBe("taking_longer");
  });
});
