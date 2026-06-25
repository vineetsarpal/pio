export type PolicyStatusView = "missing_link" | "verifying" | "active" | "taking_longer";

export function resolvePolicyStatusView(input: {
  hasCredentials: boolean;
  activated: boolean;
  elapsedMs: number;
  timeoutMs: number;
}): PolicyStatusView {
  if (!input.hasCredentials) return "missing_link";
  if (input.activated) return "active";
  if (input.elapsedMs >= input.timeoutMs) return "taking_longer";
  return "verifying";
}
