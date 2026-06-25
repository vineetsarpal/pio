export type PolicyStatusView = "verifying" | "active" | "taking_longer";

export function resolvePolicyStatusView(input: {
  activated: boolean;
  elapsedMs: number;
  timeoutMs: number;
}): PolicyStatusView {
  if (input.activated) return "active";
  if (input.elapsedMs >= input.timeoutMs) return "taking_longer";
  return "verifying";
}
