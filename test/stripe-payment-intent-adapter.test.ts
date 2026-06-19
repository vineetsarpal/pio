import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveStripePaymentIntentAdapter } from "@/lib/stripe-payment-intent";
import { quotePolicy } from "@/lib/workflow";
import { demoCoverageRequest } from "@/lib/demo-fixtures";

const policy = quotePolicy(demoCoverageRequest);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LiveStripePaymentIntentAdapter", () => {
  it("rejects non test-mode secret keys", () => {
    expect(() => new LiveStripePaymentIntentAdapter({ secretKey: "sk_live_nope" })).toThrow(
      /test-mode secret keys/
    );
  });

  it("creates a confirmed off-session PaymentIntent without payment_method_types", async () => {
    let capturedBody = "";
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      capturedBody = String(init.body);
      return new Response(JSON.stringify({ id: "pi_test_offsession_1", status: "succeeded" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new LiveStripePaymentIntentAdapter({ secretKey: "sk_test_abc" });
    const result = await adapter.createOffSessionPaymentIntent({
      policy,
      customerId: "cus_test_seed",
      paymentMethodId: "pm_card_visa"
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected the off-session charge to be created.");
    expect(result.paymentIntent.id).toBe("pi_test_offsession_1");
    expect(result.paymentIntent.status).toBe("succeeded");

    const body = new URLSearchParams(capturedBody);
    expect(body.get("confirm")).toBe("true");
    expect(body.get("off_session")).toBe("true");
    expect(body.get("customer")).toBe("cus_test_seed");
    expect(body.get("payment_method")).toBe("pm_card_visa");
    expect(body.get("amount")).toBe(String(Math.round(policy.premium.amount * 100)));
    expect(body.get("metadata[policy_id]")).toBe(policy.id);
    // Omitting payment_method_types is required for off-session confirmation.
    expect(capturedBody).not.toContain("payment_method_types");
  });

  it("fails closed with the typed decline code when authentication is required", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "authentication_required",
            message: "The payment requires authentication.",
            payment_intent: { id: "pi_test_needs_auth" }
          }
        }),
        { status: 402 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new LiveStripePaymentIntentAdapter({ secretKey: "sk_test_abc" });
    const result = await adapter.createOffSessionPaymentIntent({
      policy,
      customerId: "cus_test_seed",
      paymentMethodId: "pm_card_authenticationRequired"
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected the off-session charge to fail closed.");
    expect(result.reasonCode).toBe("authentication_required");
    expect(result.paymentIntentId).toBe("pi_test_needs_auth");
  });
});
