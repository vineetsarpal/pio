import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Both routes resolve the durable store through the factory; mock it with ONE
// shared in-memory store so the webhook sees the policy the purchase persisted.
const hoisted = vi.hoisted(() => ({ storeRef: {} as { current?: unknown } }));
vi.mock("../lib/policy-store-factory", () => ({
  getPolicyStore: () => hoisted.storeRef.current
}));

import { POST as purchase } from "../app/api/agent/purchase/route";
import { POST as paymentIntentWebhook } from "../app/api/stripe/payment-intent/route";
import { InMemoryPolicyStore } from "../lib/policy-store";
import { demoCoverageRequest } from "../lib/demo-fixtures";

const env = {
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  PIO_AGENT_SEED_KEY: process.env.PIO_AGENT_SEED_KEY,
  PIO_SEED_STRIPE_CUSTOMER: process.env.PIO_SEED_STRIPE_CUSTOMER,
  PIO_SEED_STRIPE_PAYMENT_METHOD: process.env.PIO_SEED_STRIPE_PAYMENT_METHOD
};

beforeEach(() => {
  hoisted.storeRef.current = new InMemoryPolicyStore();
  process.env.STRIPE_SECRET_KEY = "sk_test_demo";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_demo";
  process.env.PIO_AGENT_SEED_KEY = "pio_seed_key_123";
  process.env.PIO_SEED_STRIPE_CUSTOMER = "cus_test_seed";
  process.env.PIO_SEED_STRIPE_PAYMENT_METHOD = "pm_card_visa";
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function purchaseRequest(key = "pio_seed_key_123") {
  return new Request("https://pio.test/api/agent/purchase", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ idempotencyKey: "headless-001", coverageRequest: demoCoverageRequest })
  });
}

function signedWebhook(payload: string) {
  const timestamp = 1781800000;
  const signature = createHmac("sha256", "whsec_demo").update(`${timestamp}.${payload}`).digest("hex");
  return new Request("https://pio.test/api/stripe/payment-intent", {
    method: "POST",
    headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
    body: payload
  });
}

describe("headless off-session purchase → webhook → policy_issued", () => {
  it("rejects an unauthenticated purchase with 401", async () => {
    const response = await purchase(purchaseRequest("wrong_key"));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ accepted: false, reasonCode: "unauthorized" });
  });

  it("completes quote → off-session charge → webhook → policy_issued", async () => {
    // Stripe off-session confirm returns a succeeded PaymentIntent.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ id: "pi_test_headless_1", status: "succeeded" }), { status: 200 })
      )
    );

    const purchaseResponse = await purchase(purchaseRequest());
    expect(purchaseResponse.status).toBe(200);
    const purchaseBody = await purchaseResponse.json();
    expect(purchaseBody).toMatchObject({
      accepted: true,
      reasonCode: "off_session_charge_created",
      paymentIntentId: "pi_test_headless_1"
    });
    const policyId = purchaseBody.policy.id;

    // Stripe then delivers the verified payment_intent.succeeded webhook.
    const payload = JSON.stringify({
      id: "evt_test_pi_headless_1",
      type: "payment_intent.succeeded",
      created: 1781800123,
      data: {
        object: {
          id: "pi_test_headless_1",
          status: "succeeded",
          amount: 2500,
          amount_received: 2500,
          currency: "usd",
          metadata: { policy_id: policyId }
        }
      }
    });
    const webhookResponse = await paymentIntentWebhook(signedWebhook(payload));
    expect(webhookResponse.status).toBe(200);
    await expect(webhookResponse.json()).resolves.toMatchObject({
      accepted: true,
      reasonCode: "policy_issued",
      policy: { id: policyId, status: "policy_issued" }
    });

    // Ledger shows the issued policy and the premium payment event.
    const store = hoisted.storeRef.current as InMemoryPolicyStore;
    const snapshot = await store.snapshotForPolicy(policyId);
    expect(snapshot.policies[0]?.status).toBe("policy_issued");
    expect(
      snapshot.paymentEvents.some((event) => event.kind === "premium_collected" && event.reference === "pi_test_headless_1")
    ).toBe(true);
    expect(snapshot.workflowEvents.some((event) => event.kind === "policy_issued")).toBe(true);
  });

  it("replaying the same payment_intent.succeeded webhook is idempotent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ id: "pi_test_headless_2", status: "succeeded" }), { status: 200 })
      )
    );
    const purchaseBody = await (await purchase(purchaseRequest())).json();
    const policyId = purchaseBody.policy.id;
    const payload = JSON.stringify({
      id: "evt_test_pi_headless_2",
      type: "payment_intent.succeeded",
      created: 1781800123,
      data: {
        object: {
          id: "pi_test_headless_2",
          status: "succeeded",
          amount: 2500,
          amount_received: 2500,
          currency: "usd",
          metadata: { policy_id: policyId }
        }
      }
    });

    const first = await paymentIntentWebhook(signedWebhook(payload));
    const second = await paymentIntentWebhook(signedWebhook(payload));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({
      accepted: true,
      reasonCode: "policy_issued",
      policy: { status: "policy_issued" }
    });

    const store = hoisted.storeRef.current as InMemoryPolicyStore;
    const snapshot = await store.snapshotForPolicy(policyId);
    expect(snapshot.paymentEvents.filter((event) => event.kind === "premium_collected")).toHaveLength(1);
  });

  it("fails closed (no policy issued) on a payment_intent.payment_failed webhook", async () => {
    const payload = JSON.stringify({
      id: "evt_test_pi_failed_1",
      type: "payment_intent.payment_failed",
      created: 1781800123,
      data: {
        object: {
          id: "pi_test_headless_failed",
          status: "requires_payment_method",
          currency: "usd",
          metadata: { policy_id: "pio-pol-anything" },
          last_payment_error: { code: "authentication_required", message: "Authentication required." }
        }
      }
    });

    const response = await paymentIntentWebhook(signedWebhook(payload));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: false,
      policyIssued: false,
      reasonCode: "authentication_required"
    });
  });
});
