import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ storeRef: {} as { current?: unknown } }));
vi.mock("@/lib/policy-store-factory", () => ({
  getPolicyStore: () => hoisted.storeRef.current
}));

import { GET } from "@/app/api/buy/policy-status/[policyId]/route";
import { signPolicyStatusToken } from "@/lib/policy-status-token";
import { InMemoryPolicyStore } from "@/lib/policy-store";
import { demoCoverageRequest } from "@/lib/demo-fixtures";
import { quotePolicy } from "@/lib/workflow";
import type { Policy } from "@/lib/types";

const original = process.env.PIO_POLICY_STATUS_TOKEN_SECRET;
const originalStripeKey = process.env.STRIPE_SECRET_KEY;
const originalFetch = globalThis.fetch;
const future = () => Math.floor(Date.now() / 1000) + 3600;

async function seed(status: Policy["status"]): Promise<{ store: InMemoryPolicyStore; policy: Policy }> {
  const store = new InMemoryPolicyStore();
  const policy: Policy = { ...quotePolicy(demoCoverageRequest), status };
  await store.savePolicy(policy);
  return { store, policy };
}

function req(policyId: string, token: string | null): Request {
  const url = new URL(`https://pio.test/api/buy/policy-status/${policyId}`);
  if (token !== null) url.searchParams.set("t", token);
  return new Request(url);
}

function reqWithSession(policyId: string, sessionId: string): Request {
  const url = new URL(`https://pio.test/api/buy/policy-status/${policyId}`);
  url.searchParams.set("session_id", sessionId);
  return new Request(url);
}

function params(policyId: string) {
  return { params: Promise.resolve({ policyId }) };
}

beforeEach(() => {
  process.env.PIO_POLICY_STATUS_TOKEN_SECRET = "test-status-secret";
  process.env.STRIPE_SECRET_KEY = "sk_test_status";
});
afterEach(() => {
  if (original === undefined) delete process.env.PIO_POLICY_STATUS_TOKEN_SECRET;
  else process.env.PIO_POLICY_STATUS_TOKEN_SECRET = original;
  if (originalStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = originalStripeKey;
  globalThis.fetch = originalFetch;
});

describe("GET /api/buy/policy-status/[policyId]", () => {
  it("returns activated:true for a premium_paid policy with a valid token", async () => {
    const { store, policy } = await seed("premium_paid");
    hoisted.storeRef.current = store;
    const res = await GET(req(policy.id, signPolicyStatusToken(policy.id, future())), params(policy.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ found: true, status: "premium_paid", activated: true });
    expect(body.premium).toEqual(policy.premium);
  });

  it("returns activated:false for a still-quoted policy", async () => {
    const { store, policy } = await seed("policy_quoted");
    hoisted.storeRef.current = store;
    const res = await GET(req(policy.id, signPolicyStatusToken(policy.id, future())), params(policy.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ found: true, activated: false });
  });

  it("never leaks ledger fields", async () => {
    const { store, policy } = await seed("premium_paid");
    hoisted.storeRef.current = store;
    const res = await GET(req(policy.id, signPolicyStatusToken(policy.id, future())), params(policy.id));
    const body = await res.json();
    expect(body).not.toHaveProperty("paymentEvents");
    expect(body).not.toHaveProperty("workflowEvents");
  });

  it("returns 401 and does not touch the store when token is missing", async () => {
    const getPolicy = vi.fn();
    hoisted.storeRef.current = { getPolicy };
    const res = await GET(req("pio-pol-abc", null), params("pio-pol-abc"));
    expect(res.status).toBe(401);
    expect(getPolicy).not.toHaveBeenCalled();
  });

  it("accepts a paid Stripe Checkout Session as a fallback credential when token is missing", async () => {
    const { store, policy } = await seed("premium_paid");
    hoisted.storeRef.current = store;
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "cs_test_status",
          payment_status: "paid",
          metadata: { policy_id: policy.id }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as typeof fetch;

    const res = await GET(reqWithSession(policy.id, "cs_test_status"), params(policy.id));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ found: true, status: "premium_paid", activated: true });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.stripe.com/v1/checkout/sessions/cs_test_status",
      { headers: { Authorization: "Bearer sk_test_status" } }
    );
  });

  it("does not touch the store when the fallback Checkout Session belongs to a different policy", async () => {
    const getPolicy = vi.fn();
    hoisted.storeRef.current = { getPolicy };
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "cs_test_status",
          payment_status: "paid",
          metadata: { policy_id: "pio-pol-other" }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    ) as typeof fetch;

    const res = await GET(reqWithSession("pio-pol-abc", "cs_test_status"), params("pio-pol-abc"));

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ ok: false, reason: "policy_mismatch" });
    expect(getPolicy).not.toHaveBeenCalled();
  });

  it("returns 401 for a token signed for a different policy", async () => {
    const { store } = await seed("premium_paid");
    hoisted.storeRef.current = store;
    const wrong = signPolicyStatusToken("pio-pol-other", future());
    const res = await GET(req("pio-pol-abc", wrong), params("pio-pol-abc"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the policy is missing", async () => {
    hoisted.storeRef.current = new InMemoryPolicyStore();
    const res = await GET(req("pio-pol-missing", signPolicyStatusToken("pio-pol-missing", future())), params("pio-pol-missing"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ found: false });
  });
});
