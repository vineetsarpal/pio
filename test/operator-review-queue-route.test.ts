import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({ storeRef: {} as { current?: unknown } }));
vi.mock("../lib/policy-store-factory", () => ({
  getPolicyStore: () => hoisted.storeRef.current
}));

import { GET } from "../app/api/operator/review-queue/route";
import { demoCoverageRequest } from "../lib/demo-fixtures";
import { InMemoryPolicyStore, paymentEvent } from "../lib/policy-store";
import { quotePolicy } from "../lib/workflow";

beforeEach(async () => {
  const store = new InMemoryPolicyStore();
  const policy = quotePolicy(demoCoverageRequest);
  await store.savePolicy(policy);
  await store.appendPaymentEvent(
    paymentEvent({
      policyId: policy.id,
      at: "2026-06-17T18:10:04-04:00",
      kind: "payout_failed",
      reference: "evt_failed_1",
      amount: policy.payout,
      mode: "stripe_test_mode",
      providerEventId: "evt_failed_1",
      failureReason: "card_declined"
    })
  );
  hoisted.storeRef.current = store;
});

describe("GET /api/operator/review-queue", () => {
  it("returns the real operator review queue from the store", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.source).toBe("ledger_derived");
    expect(body.reviews).toHaveLength(1);
    expect(body.reviews[0]).toMatchObject({ reason: "payout_failed", severity: "high" });
  });
});
