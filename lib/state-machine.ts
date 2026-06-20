/**
 * Deterministic lifecycle state machine for PIO policies and claims.
 *
 * This merges the original pure-function policy machine with the richer
 * domain modeling first prototyped as a stateful class (PR #15). The class
 * was dropped on purpose: it owned state in-memory, which conflicts with the
 * durable Neon ledger. The useful parts (split claim lifecycle, typed errors,
 * invariant guards, structured audit events) live on here as pure functions.
 *
 * Design principles carried over from the original machine:
 *  - PURE and STORAGE-AGNOSTIC. Every function validates a transition and
 *    returns a NEW object. This module owns no state — no in-memory Map.
 *    Persistence, atomicity, and money-uniqueness stay in PolicyStore
 *    (withTransaction + DuplicateEventError). That is what makes the old one
 *    architecturally correct for the durable Neon ledger; we keep it.
 *
 * Good ideas absorbed from the PR #15 prototype:
 *  - A SEPARATE claim lifecycle instead of folding claim states into the
 *    policy status (a policy can be active while a claim runs its own course).
 *  - Typed error classes instead of bare `throw new Error`.
 *  - Explicit invariant guards (one claim per policy, settlement-once),
 *    expressed as pure checks over data the caller already loaded — the store
 *    still enforces the hard uniqueness constraint at write time.
 *  - A structured audit-event shape (actor / evidence / previous->resulting).
 */

import type { Policy, PolicyStatus } from "./types";

/* ------------------------------------------------------------------ *
 * Policy lifecycle (unchanged from the live state-machine.ts)
 * ------------------------------------------------------------------ */

export const policyTransitions: Record<PolicyStatus, PolicyStatus[]> = {
  quote_requested: ["weather_risk_checked", "policy_quoted"],
  weather_risk_checked: ["policy_quoted"],
  policy_quoted: ["premium_paid"],
  premium_paid: ["policy_issued"],
  policy_issued: ["monitoring_active"],
  monitoring_active: ["trigger_data_received"],
  trigger_data_received: ["trigger_evaluated"],
  trigger_evaluated: ["claim_approved", "manual_review", "not_triggered"],
  claim_approved: ["payout_issued"],
  manual_review: ["audit_generated"],
  not_triggered: ["audit_generated"],
  payout_issued: ["audit_generated"],
  audit_generated: []
};

/* ------------------------------------------------------------------ *
 * Claim lifecycle (extracted as its own sub-machine, from PR #15)
 *
 * NOTE: the policy table above still carries the legacy inline claim
 * states (claim_approved / payout_issued / manual_review / not_triggered)
 * so existing callers keep working during migration. The target end-state
 * is to drive claims through ClaimStatus and leave the policy table at
 * ...policy_active/policy_expired only. Flagged here so the migration is
 * explicit rather than silent drift.
 * ------------------------------------------------------------------ */

export type ClaimStatus =
  | "trigger_detected"
  | "claim_opened"
  | "claim_validated"
  | "claim_approved"
  | "settlement_initiated"
  | "settlement_completed"
  | "claim_denied"
  | "no_trigger";

export const claimTransitions: Record<ClaimStatus, ClaimStatus[]> = {
  trigger_detected: ["claim_opened", "no_trigger"],
  claim_opened: ["claim_validated", "claim_denied"],
  claim_validated: ["claim_approved", "claim_denied"],
  claim_approved: ["settlement_initiated"],
  settlement_initiated: ["settlement_completed"],
  settlement_completed: [],
  claim_denied: [],
  no_trigger: []
};

/* ------------------------------------------------------------------ *
 * Typed errors
 *
 * For persistence-level uniqueness races (duplicate payment, second payout,
 * duplicate audit snapshot) keep using DuplicateEventError from
 * ./policy-store — do NOT introduce a parallel duplicate-error type. These
 * are only for in-memory transition validation.
 * ------------------------------------------------------------------ */

export type LifecycleEntity = "policy" | "claim";

export class InvalidTransitionError extends Error {
  constructor(
    readonly entity: LifecycleEntity,
    readonly entityId: string,
    readonly fromState: string,
    readonly toState: string
  ) {
    // Preserves the legacy message for the policy path so existing
    // assertions/tests on the string keep passing.
    super(
      entity === "policy" && entityId === "policy"
        ? `Invalid policy transition from ${fromState} to ${toState}.`
        : `Invalid ${entity} transition for ${entityId}: ${fromState} -> ${toState}`
    );
    this.name = "InvalidTransitionError";
  }
}

export class InvariantViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvariantViolationError";
  }
}

/* ------------------------------------------------------------------ *
 * Policy transitions (backward-compatible public API)
 * ------------------------------------------------------------------ */

export function assertTransition(from: PolicyStatus, to: PolicyStatus): void {
  if (!policyTransitions[from].includes(to)) {
    throw new InvalidTransitionError("policy", "policy", from, to);
  }
}

export function transitionPolicy<T extends Policy>(
  policy: T,
  status: PolicyStatus,
  patch: Partial<T> = {}
): T {
  assertTransition(policy.status, status);
  return { ...policy, ...patch, status };
}

export function getAllowedTransitions(status: PolicyStatus): PolicyStatus[] {
  return [...policyTransitions[status]];
}

/* ------------------------------------------------------------------ *
 * Claim transitions (mirrors the policy API, pure + storage-agnostic)
 * ------------------------------------------------------------------ */

export type ClaimLike = { id: string; status: ClaimStatus };

export function assertClaimTransition(from: ClaimStatus, to: ClaimStatus, claimId: string): void {
  if (!claimTransitions[from].includes(to)) {
    throw new InvalidTransitionError("claim", claimId, from, to);
  }
}

export function transitionClaim<T extends ClaimLike>(
  claim: T,
  status: ClaimStatus,
  patch: Partial<T> = {}
): T {
  assertClaimTransition(claim.status, status, claim.id);
  return { ...claim, ...patch, status };
}

export function getAllowedClaimTransitions(status: ClaimStatus): ClaimStatus[] {
  return [...claimTransitions[status]];
}

/* ------------------------------------------------------------------ *
 * Invariant guards
 *
 * Pure checks the caller runs against state it already loaded (inside the
 * store's withTransaction). They give a fast, typed failure BEFORE the write;
 * the database unique constraint remains the source of truth for races.
 * ------------------------------------------------------------------ */

const TERMINAL_CLAIM_STATES: ClaimStatus[] = ["settlement_completed", "claim_denied", "no_trigger"];

/** A policy may have at most one open/decided claim. */
export function assertOneClaimPerPolicy(policyId: string, existingClaims: ClaimLike[]): void {
  const active = existingClaims.filter((claim) => !TERMINAL_CLAIM_STATES.includes(claim.status));
  if (active.length > 0) {
    throw new InvariantViolationError(
      `Policy ${policyId} already has an open claim (${active[0].id}).`
    );
  }
  if (existingClaims.some((claim) => claim.status === "no_trigger")) {
    throw new InvariantViolationError(
      `Policy ${policyId} already recorded a no-trigger decision; no further claim can be opened.`
    );
  }
}

/** Settlement may complete at most once per policy. */
export function assertSettlementOnce(policyId: string, existingClaims: ClaimLike[]): void {
  if (existingClaims.some((claim) => claim.status === "settlement_completed")) {
    throw new InvariantViolationError(`Policy ${policyId} has already settled a claim.`);
  }
}

/* ------------------------------------------------------------------ *
 * Structured audit events
 *
 * Shape lines up with the existing WorkflowEvent/audit style (see lib/audit.ts
 * and lib/policy-store.ts). Caller persists it via appendWorkflowEvent inside
 * the same transaction as the transition.
 * ------------------------------------------------------------------ */

export type LifecycleAuditEvent = {
  actor: string;
  entity: { type: LifecycleEntity; id: string };
  fromState: PolicyStatus | ClaimStatus | null;
  toState: PolicyStatus | ClaimStatus;
  at: string;
  evidence: Record<string, unknown>;
};

export function lifecycleAuditEvent(input: {
  actor: string;
  entity: LifecycleEntity;
  entityId: string;
  fromState: PolicyStatus | ClaimStatus | null;
  toState: PolicyStatus | ClaimStatus;
  at: string;
  evidence?: Record<string, unknown>;
}): LifecycleAuditEvent {
  return {
    actor: input.actor,
    entity: { type: input.entity, id: input.entityId },
    fromState: input.fromState,
    toState: input.toState,
    at: input.at,
    evidence: { ...(input.evidence ?? {}) }
  };
}
