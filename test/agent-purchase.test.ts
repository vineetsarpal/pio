import { describe, expect, it } from "vitest";
import { handleAgentOffSessionPurchase } from "@/lib/agent-purchase";
import { InMemoryPolicyStore } from "@/lib/policy-store";
import { demoCoverageRequest } from "@/lib/demo-fixtures";
import type { OffSessionChargeResult } from "@/lib/stripe-payment-intent";
import type { Policy } from "@/lib/types";

const seed = { agentId: "agent_seed_demo", customerId: "cus_test_seed", paymentMethodId: "pm_card_visa" };

function paymentsStub(result: OffSessionChargeResult, captured?: { policy?: Policy }) {
  return {
    async createOffSessionPaymentIntent(input: { policy: Policy }): Promise<OffSessionChargeResult> {
      if (captured) captured.policy = input.policy;
      return result;
    }
  };
}

describe("handleAgentOffSessionPurchase", () => {
  it("persists a quoted policy and creates an off-session charge", async () => {
    const store = new InMemoryPolicyStore();
    const captured: { policy?: Policy } = {};
    const payments = paymentsStub({ ok: true, paymentIntent: { id: "pi_test_ok", status: "succeeded" } }, captured);

    const result = await handleAgentOffSessionPurchase(
      { idempotencyKey: "idem-1", coverageRequest: demoCoverageRequest },
      { store, payments, seed }
    );

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error("Expected the off-session purchase to be accepted.");
    expect(result.paymentIntentId).toBe("pi_test_ok");
    expect(result.agentId).toBe("agent_seed_demo");

    // The charge runs against the agent-scoped seeded customer + vaulted card.
    expect(captured.policy?.id).toBe(result.policy.id);

    const stored = await store.getPolicy(result.policy.id);
    expect(stored?.status).toBe("policy_quoted");
    // The policy id is unique per purchase, not the fixed demo quote id.
    expect(stored?.id).not.toBe("pio-pol-2026-0001");
  });

  it("fails closed without issuing when the off-session charge is declined", async () => {
    const store = new InMemoryPolicyStore();
    const payments = paymentsStub({
      ok: false,
      reasonCode: "authentication_required",
      message: "The payment requires authentication.",
      paymentIntentId: "pi_test_declined"
    });

    const result = await handleAgentOffSessionPurchase(
      { idempotencyKey: "idem-2", coverageRequest: demoCoverageRequest },
      { store, payments, seed }
    );

    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error("Expected the declined charge to fail closed.");
    expect(result.reasonCode).toBe("authentication_required");

    // No policy may ever reach premium_paid / policy_issued on a failed charge.
    const snapshot = await store.snapshot();
    expect(snapshot.policies.every((policy) => policy.status === "policy_quoted")).toBe(true);
    expect(snapshot.paymentEvents).toHaveLength(0);
  });
});
