import { describe, expect, it } from "vitest";
import {
  DOMAIN_CLAIM_STATES,
  DOMAIN_POLICY_STATES,
  DuplicateDomainOperationError,
  InvalidDomainTransitionError,
  PioDomainStateMachine,
  allowedDomainClaimTransitions,
  allowedDomainPolicyTransitions
} from "@/lib/domain-state-machine";

const actor = "rules_engine";

function activePolicy(machine: PioDomainStateMachine, policyId = "pol_demo_active") {
  machine.createPolicyQuote({ policyId, quoteId: `qt_${policyId}`, actor: "customer" });
  machine.generateQuote(policyId, { actor, evidence: { premiumAmountCents: 1200 } });
  machine.createCheckout(policyId, { actor: "stripe", evidence: { checkoutSessionId: `cs_${policyId}` } });
  machine.markPremiumPaid(policyId, { actor: "stripe", evidence: { providerEventId: `evt_${policyId}` } });
  return machine.activatePolicy(policyId, { actor, evidence: { premiumEventId: `evt_${policyId}` } });
}

describe("PIO domain state machine", () => {
  it("exposes deterministic transition tables for policy and claim states", () => {
    expect(allowedDomainPolicyTransitions(DOMAIN_POLICY_STATES.quoteRequested)).toEqual([
      DOMAIN_POLICY_STATES.quoteGenerated
    ]);
    expect(allowedDomainPolicyTransitions(DOMAIN_POLICY_STATES.policyExpired)).toEqual([]);
    expect(allowedDomainClaimTransitions(DOMAIN_CLAIM_STATES.claimApproved)).toEqual([
      DOMAIN_CLAIM_STATES.settlementInitiated
    ]);
    expect(allowedDomainClaimTransitions(DOMAIN_CLAIM_STATES.claimDenied)).toEqual([]);
  });

  it("walks the policy lifecycle and writes an audit event for every state change", () => {
    const machine = new PioDomainStateMachine({ now: () => "2026-06-20T12:00:00.000Z" });

    machine.createPolicyQuote({ policyId: "pol_demo_001", quoteId: "qt_demo_001", actor: "customer" });
    machine.generateQuote("pol_demo_001", { actor, evidence: { premiumAmountCents: 1200 } });
    machine.createCheckout("pol_demo_001", { actor: "stripe", evidence: { checkoutSessionId: "cs_test_001" } });
    machine.markPremiumPaid("pol_demo_001", { actor: "stripe", evidence: { providerEventId: "evt_001" } });
    machine.activatePolicy("pol_demo_001", { actor, evidence: { premiumEventId: "evt_001" } });
    machine.expirePolicy("pol_demo_001", { actor: "system", evidence: { reason: "coverage window ended" } });

    expect(machine.getPolicy("pol_demo_001").state).toBe(DOMAIN_POLICY_STATES.policyExpired);
    expect(machine.auditEvents.map((event) => event.action)).toEqual([
      DOMAIN_POLICY_STATES.quoteRequested,
      DOMAIN_POLICY_STATES.quoteGenerated,
      DOMAIN_POLICY_STATES.checkoutCreated,
      DOMAIN_POLICY_STATES.premiumPaid,
      DOMAIN_POLICY_STATES.policyActive,
      DOMAIN_POLICY_STATES.policyExpired
    ]);
    expect(machine.auditEvents[0]).toMatchObject({
      id: "aud_000001",
      actor: "customer",
      entity: { type: "policy", id: "pol_demo_001" },
      evidence: { quoteId: "qt_demo_001" },
      previousState: null,
      resultingState: DOMAIN_POLICY_STATES.quoteRequested
    });
  });

  it("blocks invalid policy jumps without writing audit entries", () => {
    const machine = new PioDomainStateMachine();
    machine.createPolicyQuote({ policyId: "pol_demo_002", quoteId: "qt_demo_002" });

    expect(() =>
      machine.activatePolicy("pol_demo_002", { actor, evidence: { premiumEventId: "evt_missing" } })
    ).toThrow(InvalidDomainTransitionError);
    expect(machine.getPolicy("pol_demo_002").state).toBe(DOMAIN_POLICY_STATES.quoteRequested);
    expect(machine.auditEvents).toHaveLength(1);
  });

  it("approves and settles a triggered claim once", () => {
    const machine = new PioDomainStateMachine({ now: () => "2026-06-20T13:00:00.000Z" });
    activePolicy(machine, "pol_demo_003");

    const trigger = machine.detectTrigger("pol_demo_003", {
      actor: "weather_oracle",
      evidence: { weatherEvidenceId: "wx_demo_003", observedRainfallMm: 14.2, thresholdMm: 10, triggerMet: true }
    });
    expect(trigger.state).toBe(DOMAIN_CLAIM_STATES.triggerDetected);

    machine.openClaim("clm_demo_003", {
      actor: "hermes_agent",
      evidence: { policyId: "pol_demo_003", weatherEvidenceId: "wx_demo_003" }
    });
    machine.validateClaim("clm_demo_003", { actor, evidence: { weatherEvidenceId: "wx_demo_003" } });
    machine.approveClaim("clm_demo_003", {
      actor,
      evidence: { approvedAmountCents: 10000, reason: "Observed 14.2mm >= 10mm threshold" }
    });
    machine.initiateSettlement("clm_demo_003", { actor: "hermes_agent", evidence: { settlementId: "set_demo_003" } });
    machine.completeSettlement("clm_demo_003", { actor: "system", evidence: { ledgerEntryId: "led_demo_003" } });

    expect(machine.getClaim("clm_demo_003").state).toBe(DOMAIN_CLAIM_STATES.settlementCompleted);
    expect(machine.getPolicy("pol_demo_003").hasSettledClaim).toBe(true);
    expect(machine.auditEvents.slice(-6).map((event) => event.action)).toEqual([
      DOMAIN_CLAIM_STATES.triggerDetected,
      DOMAIN_CLAIM_STATES.claimOpened,
      DOMAIN_CLAIM_STATES.claimValidated,
      DOMAIN_CLAIM_STATES.claimApproved,
      DOMAIN_CLAIM_STATES.settlementInitiated,
      DOMAIN_CLAIM_STATES.settlementCompleted
    ]);
  });

  it("records no-trigger decisions as terminal and blocks claim opening", () => {
    const machine = new PioDomainStateMachine();
    activePolicy(machine, "pol_demo_004");

    machine.detectTrigger("pol_demo_004", {
      actor: "weather_oracle",
      evidence: { weatherEvidenceId: "wx_demo_004", observedRainfallMm: 4.1, thresholdMm: 10, triggerMet: false }
    });

    expect(machine.getClaim("auto_pol_demo_004").state).toBe(DOMAIN_CLAIM_STATES.noTrigger);
    expect(() =>
      machine.openClaim("clm_demo_004", {
        actor: "hermes_agent",
        evidence: { policyId: "pol_demo_004", weatherEvidenceId: "wx_demo_004" }
      })
    ).toThrow(DuplicateDomainOperationError);
  });

  it("can deny validated claims and prevent denied claims from settling", () => {
    const machine = new PioDomainStateMachine();
    activePolicy(machine, "pol_demo_005");
    machine.detectTrigger("pol_demo_005", {
      actor: "weather_oracle",
      evidence: { weatherEvidenceId: "wx_demo_005", triggerMet: true }
    });
    machine.openClaim("clm_demo_005", { actor: "hermes_agent", evidence: { policyId: "pol_demo_005" } });
    machine.validateClaim("clm_demo_005", { actor, evidence: { weatherEvidenceId: "wx_demo_005" } });
    machine.denyClaim("clm_demo_005", {
      actor,
      evidence: { reason: "Evidence failed deterministic validation" }
    });

    expect(machine.getClaim("clm_demo_005").state).toBe(DOMAIN_CLAIM_STATES.claimDenied);
    expect(machine.auditEvents.at(-1)?.action).toBe(DOMAIN_CLAIM_STATES.claimDenied);
    expect(() =>
      machine.initiateSettlement("clm_demo_005", {
        actor: "hermes_agent",
        evidence: { settlementId: "set_denied" }
      })
    ).toThrow(InvalidDomainTransitionError);
  });

  it("blocks duplicate claims and duplicate settlements", () => {
    const machine = new PioDomainStateMachine();
    activePolicy(machine, "pol_demo_006");
    machine.detectTrigger("pol_demo_006", { actor: "weather_oracle", evidence: { weatherEvidenceId: "wx_demo_006" } });
    machine.openClaim("clm_demo_006", { actor: "hermes_agent", evidence: { policyId: "pol_demo_006" } });
    machine.validateClaim("clm_demo_006", { actor, evidence: { weatherEvidenceId: "wx_demo_006" } });
    machine.approveClaim("clm_demo_006", { actor, evidence: { approvedAmountCents: 10000 } });
    machine.initiateSettlement("clm_demo_006", { actor: "hermes_agent", evidence: { settlementId: "set_demo_006" } });
    machine.completeSettlement("clm_demo_006", { actor: "system", evidence: { ledgerEntryId: "led_demo_006" } });

    expect(() =>
      machine.openClaim("clm_demo_006b", { actor: "hermes_agent", evidence: { policyId: "pol_demo_006" } })
    ).toThrow(DuplicateDomainOperationError);
    expect(() =>
      machine.initiateSettlement("clm_demo_006", { actor: "hermes_agent", evidence: { settlementId: "set_duplicate" } })
    ).toThrow(DuplicateDomainOperationError);
  });
});
