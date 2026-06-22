import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ storeRef: {} as { current?: unknown } }));
vi.mock("../lib/policy-store-factory", () => ({
  getPolicyStore: () => hoisted.storeRef.current
}));

import { POST as settle } from "../app/api/operator/policy/[policyId]/settle/route";
import { InMemoryPolicyStore } from "../lib/policy-store";
import { demoCoverageRequest } from "../lib/demo-fixtures";
import { issuePolicy, markPremiumPaid, quotePolicy } from "../lib/workflow";

const originalKey = process.env.PIO_OPERATOR_KEY;

async function seedIssuedPolicy(store: InMemoryPolicyStore) {
  const issued = issuePolicy(
    markPremiumPaid(quotePolicy(demoCoverageRequest), "cs_test_seed", "2026-06-18T09:00:00-04:00"),
    "2026-06-18T09:01:00-04:00"
  );
  await store.savePolicy(issued);
  return issued;
}

function settleRequest(key: string | undefined = "pio_operator_key_123") {
  return new Request("https://pio.test/api/operator/policy/x/settle", {
    method: "POST",
    headers: key ? { authorization: `Bearer ${key}` } : {}
  });
}

beforeEach(() => {
  hoisted.storeRef.current = new InMemoryPolicyStore();
  process.env.PIO_OPERATOR_KEY = "pio_operator_key_123";
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.PIO_OPERATOR_KEY;
  else process.env.PIO_OPERATOR_KEY = originalKey;
});

describe("POST /api/operator/policy/[policyId]/settle", () => {
  it("rejects an unauthenticated operator with 401", async () => {
    const store = hoisted.storeRef.current as InMemoryPolicyStore;
    const issued = await seedIssuedPolicy(store);
    const response = await settle(settleRequest("wrong_key"), {
      params: Promise.resolve({ policyId: issued.id })
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ reasonCode: "unauthorized" });
  });

  it("runs deterministic settlement and requests a payout for an authenticated operator", async () => {
    const store = hoisted.storeRef.current as InMemoryPolicyStore;
    const issued = await seedIssuedPolicy(store);

    const response = await settle(settleRequest(), {
      params: Promise.resolve({ policyId: issued.id })
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      outcome: "payout_requested",
      policy: { status: "claim_approved" }
    });
  });

  it("returns 404 when the policy is not found", async () => {
    const response = await settle(settleRequest(), {
      params: Promise.resolve({ policyId: "pio-pol-missing" })
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ reasonCode: "policy_not_found" });
  });
});
