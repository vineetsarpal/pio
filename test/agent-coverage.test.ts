import { describe, expect, it } from "vitest";
import { demoCoverageRequest } from "@/lib/demo-fixtures";
import {
  AgentPurchaseConfirmationStore,
  handleAgentCoverageRequest,
  handleAgentPurchaseConfirmation
} from "@/lib/agent-coverage";
import { SimulatedHermesStripeSkillsAdapter } from "./fakes";

const payments = new SimulatedHermesStripeSkillsAdapter();

const agentRequest = {
  ...demoCoverageRequest,
  agentId: "ops-agent-north-pier",
  purchaseIntent: "buy_if_within_budget" as const
};

describe("agent coverage API contract", () => {
  it("accepts a customer-owned agent request when premium is within budget", () => {
    const result = handleAgentCoverageRequest(agentRequest);

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error("Expected accepted agent quote.");
    expect(result.reasonCode).toBe("quote_ready");
    expect(result.nextAction).toBe("create_checkout");
    expect(result.policy.premium.amount).toBe(25);
    expect(result.constraints.premiumWithinBudget).toBe(true);
  });

  it("accepts an agent request that omits maximumPremium (no budget cap)", () => {
    const { maximumPremium: _omit, ...withoutCap } = agentRequest;
    const result = handleAgentCoverageRequest(withoutCap);

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error("Expected accepted agent quote without a cap.");
    expect(result.reasonCode).toBe("quote_ready");
    expect(result.policy.premium.amount).toBe(25);
  });

  it("rejects a customer-owned agent request when the quoted premium exceeds the cap", () => {
    const result = handleAgentCoverageRequest({
      ...agentRequest,
      maximumPremium: {
        amount: 10,
        currency: "USD"
      }
    });

    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error("Expected rejected agent quote.");
    expect(result.reasonCode).toBe("premium_cap_exceeded");
    expect(result.constraints?.quotedPremium?.amount).toBe(25);
    expect(result.constraints?.maximumPremium?.amount).toBe(10);
  });

  it("returns a machine-readable invalid_request rejection for malformed input", () => {
    const result = handleAgentCoverageRequest({
      agentId: "ops-agent-north-pier"
    });

    expect(result).toEqual({
      accepted: false,
      reasonCode: "invalid_request",
      message: "customerName is required."
    });
  });

  it("rejects unsupported currencies before quoting", () => {
    const result = handleAgentCoverageRequest({
      ...agentRequest,
      desiredPayout: {
        amount: 500,
        currency: "CAD"
      }
    });

    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error("Expected unsupported currency rejection.");
    expect(result.reasonCode).toBe("unsupported_currency");
  });

  it("creates checkout only after explicit agent purchase confirmation", async () => {
    const result = await handleAgentPurchaseConfirmation(
      {
        agentId: "ops-agent-north-pier",
        quoteId: "pio-pol-2026-0001",
        idempotencyKey: "idem-agent-buy-0001",
        authorization: "confirm_purchase",
        coverageRequest: demoCoverageRequest,
        maximumPremium: {
          amount: 75,
          currency: "USD"
        }
      },
      { payments }
    );

    expect(result.accepted).toBe(true);
    if (!result.accepted) throw new Error("Expected checkout confirmation.");
    expect(result.reasonCode).toBe("checkout_created");
    expect(result.checkout.id).toBe("cs_test_pio_premium_0001");
    expect(result.nextAction).toBe("complete_stripe_checkout");
    expect(result.idempotentReplay).toBe(false);
  });

  it("returns the same checkout response for an idempotent replay", async () => {
    const confirmations = new AgentPurchaseConfirmationStore();
    const request = {
      agentId: "ops-agent-north-pier",
      quoteId: "pio-pol-2026-0001",
      idempotencyKey: "idem-agent-buy-0002",
      authorization: "confirm_purchase",
      coverageRequest: demoCoverageRequest,
      maximumPremium: {
        amount: 75,
        currency: "USD"
      }
    };

    const first = await handleAgentPurchaseConfirmation(request, { payments, confirmations });
    const second = await handleAgentPurchaseConfirmation(request, { payments, confirmations });

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    if (!first.accepted || !second.accepted) throw new Error("Expected idempotent checkout replay.");
    expect(first.checkout).toEqual(second.checkout);
    expect(first.idempotentReplay).toBe(false);
    expect(second.idempotentReplay).toBe(true);
  });

  it("rejects idempotency key reuse with different confirmation details", async () => {
    const confirmations = new AgentPurchaseConfirmationStore();
    const request = {
      agentId: "ops-agent-north-pier",
      quoteId: "pio-pol-2026-0001",
      idempotencyKey: "idem-agent-buy-0003",
      authorization: "confirm_purchase",
      coverageRequest: demoCoverageRequest,
      maximumPremium: {
        amount: 75,
        currency: "USD"
      }
    };

    await handleAgentPurchaseConfirmation(request, { payments, confirmations });
    const conflict = await handleAgentPurchaseConfirmation(
      {
        ...request,
        maximumPremium: {
          amount: 80,
          currency: "USD"
        }
      },
      { payments, confirmations }
    );

    expect(conflict.accepted).toBe(false);
    if (conflict.accepted) throw new Error("Expected idempotency conflict.");
    expect(conflict.reasonCode).toBe("idempotency_conflict");
  });

  it("re-checks premium cap during purchase confirmation", async () => {
    const result = await handleAgentPurchaseConfirmation(
      {
        agentId: "ops-agent-north-pier",
        quoteId: "pio-pol-2026-0001",
        idempotencyKey: "idem-agent-buy-0004",
        authorization: "confirm_purchase",
        coverageRequest: demoCoverageRequest,
        maximumPremium: {
          amount: 10,
          currency: "USD"
        }
      },
      { payments }
    );

    expect(result.accepted).toBe(false);
    if (result.accepted) throw new Error("Expected premium cap rejection.");
    expect(result.reasonCode).toBe("premium_cap_exceeded");
    expect(result.constraints?.quotedPremium?.amount).toBe(25);
  });
});
