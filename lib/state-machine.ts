import type { Policy, PolicyStatus } from "./types";

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

export function assertTransition(from: PolicyStatus, to: PolicyStatus): void {
  if (!policyTransitions[from].includes(to)) {
    throw new Error(`Invalid policy transition from ${from} to ${to}.`);
  }
}

export function transitionPolicy<T extends Policy>(
  policy: T,
  status: PolicyStatus,
  patch: Partial<T> = {}
): T {
  assertTransition(policy.status, status);
  return {
    ...policy,
    ...patch,
    status
  };
}

export function getAllowedTransitions(status: PolicyStatus): PolicyStatus[] {
  return [...policyTransitions[status]];
}
