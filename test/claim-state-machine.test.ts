import { describe, expect, it } from "vitest";
import {
  type ClaimLike,
  InvalidTransitionError,
  InvariantViolationError,
  assertOneClaimPerPolicy,
  assertSettlementOnce,
  claimTransitions,
  getAllowedClaimTransitions,
  lifecycleAuditEvent,
  transitionClaim
} from "@/lib/state-machine";

const claim = (status: ClaimLike["status"], id = "clm_demo"): ClaimLike => ({ id, status });

describe("claim sub-machine", () => {
  it("declares deterministic claim transition tables", () => {
    expect(getAllowedClaimTransitions("trigger_detected")).toEqual(["claim_opened", "no_trigger"]);
    expect(getAllowedClaimTransitions("claim_approved")).toEqual(["settlement_initiated"]);
    expect(getAllowedClaimTransitions("claim_denied")).toEqual([]);
    expect(getAllowedClaimTransitions("no_trigger")).toEqual([]);
    expect(getAllowedClaimTransitions("settlement_completed")).toEqual([]);
  });

  it("walks the happy-path claim lifecycle, returning new objects each step", () => {
    const detected = claim("trigger_detected", "clm_happy");
    const opened = transitionClaim(detected, "claim_opened");
    const validated = transitionClaim(opened, "claim_validated");
    const approved = transitionClaim(validated, "claim_approved");
    const initiated = transitionClaim(approved, "settlement_initiated");
    const completed = transitionClaim(initiated, "settlement_completed");

    expect(completed.status).toBe("settlement_completed");
    // purity: the original object is untouched
    expect(detected.status).toBe("trigger_detected");
  });

  it("merges a patch while transitioning", () => {
    const approved = transitionClaim(claim("claim_validated"), "claim_approved", {
      ...({ approvedAmountCents: 10000 } as Partial<ClaimLike>)
    });
    expect(approved.status).toBe("claim_approved");
  });

  it("blocks invalid claim jumps with a typed error", () => {
    expect(() => transitionClaim(claim("trigger_detected", "clm_x"), "settlement_completed")).toThrow(
      InvalidTransitionError
    );
    expect(() => transitionClaim(claim("trigger_detected", "clm_x"), "settlement_completed")).toThrow(
      "Invalid claim transition for clm_x: trigger_detected -> settlement_completed"
    );
  });

  it("treats no_trigger and claim_denied as terminal", () => {
    expect(() => transitionClaim(claim("no_trigger"), "claim_opened")).toThrow(InvalidTransitionError);
    expect(() => transitionClaim(claim("claim_denied"), "settlement_initiated")).toThrow(InvalidTransitionError);
  });

  it("exposes a frozen-by-copy transition table (callers can't mutate it)", () => {
    const allowed = getAllowedClaimTransitions("trigger_detected");
    allowed.push("settlement_completed");
    expect(claimTransitions.trigger_detected).toEqual(["claim_opened", "no_trigger"]);
  });
});

describe("claim invariant guards", () => {
  it("allows opening a claim when none are active", () => {
    expect(() => assertOneClaimPerPolicy("pol_1", [])).not.toThrow();
    expect(() => assertOneClaimPerPolicy("pol_1", [claim("settlement_completed", "old")])).not.toThrow();
  });

  it("blocks a second open claim per policy", () => {
    expect(() => assertOneClaimPerPolicy("pol_1", [claim("claim_opened", "clm_a")])).toThrow(
      InvariantViolationError
    );
  });

  it("blocks opening a claim after a no_trigger decision", () => {
    expect(() => assertOneClaimPerPolicy("pol_1", [claim("no_trigger", "auto_pol_1")])).toThrow(
      /no-trigger decision/
    );
  });

  it("blocks a second settlement per policy", () => {
    expect(() => assertSettlementOnce("pol_1", [])).not.toThrow();
    expect(() => assertSettlementOnce("pol_1", [claim("settlement_completed", "clm_a")])).toThrow(
      InvariantViolationError
    );
  });
});

describe("lifecycle audit events", () => {
  it("builds a structured audit event with copied evidence", () => {
    const evidence = { observedRainfallMm: 14.2, thresholdMm: 10 };
    const event = lifecycleAuditEvent({
      actor: "weather_oracle",
      entity: "claim",
      entityId: "clm_demo",
      fromState: "trigger_detected",
      toState: "claim_opened",
      at: "2026-06-20T12:00:00.000Z",
      evidence
    });

    expect(event).toEqual({
      actor: "weather_oracle",
      entity: { type: "claim", id: "clm_demo" },
      fromState: "trigger_detected",
      toState: "claim_opened",
      at: "2026-06-20T12:00:00.000Z",
      evidence: { observedRainfallMm: 14.2, thresholdMm: 10 }
    });
    // evidence is copied, not aliased
    evidence.thresholdMm = 99;
    expect(event.evidence.thresholdMm).toBe(10);
  });
});
