import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "../lib/db/schema";
import { demoCoverageRequest } from "../lib/demo-fixtures";
import { handlePremiumCollectedEvent } from "../lib/payment-events";
import {
  DuplicateEventError,
  InMemoryPolicyStore,
  paymentEvent,
  type PolicyStore,
  workflowEvent
} from "../lib/policy-store";
import { PostgresPolicyStore } from "../lib/postgres-policy-store";
import { quotePolicy } from "../lib/workflow";
import type { AuditSnapshot } from "../lib/types";

/**
 * Both PolicyStore implementations must behave identically. This suite runs the
 * same scenarios against the in-memory test double and a PGlite-backed Postgres
 * store (real Postgres semantics: JSONB, partial unique indexes, transactions —
 * no Docker, no network), which also exercises the generated migration SQL.
 */
const harnesses: { name: string; create: () => Promise<PolicyStore> }[] = [
  {
    name: "InMemoryPolicyStore",
    create: async () => new InMemoryPolicyStore()
  },
  {
    name: "PostgresPolicyStore (pglite)",
    create: async () => {
      const db = drizzle(new PGlite(), { schema });
      await migrate(db, { migrationsFolder: "./drizzle" });
      return new PostgresPolicyStore(db);
    }
  }
];

describe.each(harnesses)("$name conformance", ({ create }) => {
  let store: PolicyStore;

  beforeEach(async () => {
    store = await create();
  });

  it("round-trips a policy with full fidelity", async () => {
    const policy = quotePolicy(demoCoverageRequest);
    await store.savePolicy(policy);
    expect(await store.getPolicy(policy.id)).toEqual(policy);
  });

  it("returns undefined for an unknown policy", async () => {
    expect(await store.getPolicy("does-not-exist")).toBeUndefined();
  });

  it("blocks a duplicate payment event by (policyId, kind, reference)", async () => {
    const policy = quotePolicy(demoCoverageRequest);
    await store.savePolicy(policy);
    const event = paymentEvent({
      policyId: policy.id,
      at: "2026-06-17T09:01:08-04:00",
      kind: "premium_collected",
      reference: "cs_test_dup",
      amount: policy.premium,
      mode: "stripe_test_mode"
    });

    await store.appendPaymentEvent(event);
    await expect(store.appendPaymentEvent(event)).rejects.toBeInstanceOf(DuplicateEventError);
  });

  it("enforces one payout per policy across different references", async () => {
    const policy = quotePolicy(demoCoverageRequest);
    await store.savePolicy(policy);
    await store.appendPaymentEvent(
      paymentEvent({
        policyId: policy.id,
        at: "2026-06-17T18:10:04-04:00",
        kind: "payout_issued",
        reference: "po_test_a",
        amount: policy.payout,
        mode: "stripe_test_mode"
      })
    );

    await expect(
      store.appendPaymentEvent(
        paymentEvent({
          policyId: policy.id,
          at: "2026-06-17T18:10:05-04:00",
          kind: "payout_issued",
          reference: "po_test_b",
          amount: policy.payout,
          mode: "stripe_test_mode"
        })
      )
    ).rejects.toBeInstanceOf(DuplicateEventError);
    expect(await store.hasPayout(policy.id)).toBe(true);
  });

  it("blocks a duplicate audit snapshot id", async () => {
    const policy = quotePolicy(demoCoverageRequest);
    await store.savePolicy(policy);
    const snapshot: AuditSnapshot = {
      id: "audit-dup",
      policyId: policy.id,
      report: { id: "rep-1", status: "final", generatedAt: "2026-06-17T18:11:00-04:00", sourceEventCount: 1, summary: "x", facts: [] },
      createdAt: "2026-06-17T18:11:00-04:00",
      sourceEventCount: 1,
      immutable: true
    };

    await store.appendAuditSnapshot(snapshot);
    await expect(store.appendAuditSnapshot(snapshot)).rejects.toBeInstanceOf(DuplicateEventError);
  });

  it("rolls back all writes when the unit of work throws", async () => {
    const policy = quotePolicy(demoCoverageRequest);

    await expect(
      store.withTransaction(async (tx) => {
        await tx.savePolicy(policy);
        await tx.appendWorkflowEvent(
          workflowEvent({
            policyId: policy.id,
            at: "2026-06-17T09:01:03-04:00",
            kind: "policy_quoted",
            actor: "PIO deterministic engine",
            summary: "should be rolled back",
            data: {}
          })
        );
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    expect(await store.getPolicy(policy.id)).toBeUndefined();
    const ledger = await store.snapshotForPolicy(policy.id);
    expect(ledger.workflowEvents).toHaveLength(0);
  });

  it("returns workflow events in insertion order from snapshot", async () => {
    const policy = quotePolicy(demoCoverageRequest);
    await store.savePolicy(policy);
    const kinds = ["coverage_requested", "policy_quoted", "premium_verified"] as const;
    for (const [index, kind] of kinds.entries()) {
      await store.appendWorkflowEvent(
        workflowEvent({
          policyId: policy.id,
          at: `2026-06-17T09:0${index}:00-04:00`,
          kind,
          actor: "Gauge",
          summary: kind,
          data: {}
        })
      );
    }

    const ledger = await store.snapshot();
    expect(ledger.workflowEvents.map((event) => event.kind)).toEqual([...kinds]);
  });

  it("scopes snapshotForPolicy to a single policy", async () => {
    // quotePolicy emits a fixed id, so assign distinct ids for the two-policy case.
    const first = { ...quotePolicy(demoCoverageRequest), id: "policy-first" };
    const second = { ...quotePolicy(demoCoverageRequest), id: "policy-second" };
    await store.savePolicy(first);
    await store.savePolicy(second);
    await store.appendWorkflowEvent(
      workflowEvent({ policyId: second.id, at: "2026-06-17T09:01:00-04:00", kind: "policy_quoted", actor: "Gauge", summary: "s", data: {} })
    );

    const scoped = await store.snapshotForPolicy(first.id);
    expect(scoped.policies.map((p) => p.id)).toEqual([first.id]);
    expect(scoped.workflowEvents).toHaveLength(0);
  });

  it("surfaces payout failures in the operator review queue", async () => {
    const policy = quotePolicy(demoCoverageRequest);
    await store.savePolicy(policy);
    await store.appendPaymentEvent(
      paymentEvent({
        policyId: policy.id,
        at: "2026-06-17T18:10:04-04:00",
        kind: "payout_failed",
        reference: "evt_payout_failed_1",
        amount: policy.payout,
        mode: "stripe_test_mode",
        providerEventId: "evt_payout_failed_1",
        failureReason: "card_declined"
      })
    );

    const queue = await store.getOperatorReviewQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ policyId: policy.id, reason: "payout_failed", severity: "high" });
  });

  it("treats a repeated premium-collected event as an idempotent replay", async () => {
    const policy = quotePolicy(demoCoverageRequest);
    await store.savePolicy(policy);
    const event = {
      providerEventId: "evt_premium_1",
      checkoutId: "cs_test_replay",
      policyId: policy.id,
      amount: policy.premium,
      mode: "stripe_test_mode" as const,
      paidAt: "2026-06-17T09:01:08-04:00"
    };

    const first = await handlePremiumCollectedEvent(event, store);
    const second = await handlePremiumCollectedEvent(event, store);

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    if (first.accepted && second.accepted) {
      expect(first.idempotentReplay).toBe(false);
      expect(second.idempotentReplay).toBe(true);
      expect(second.policy.status).toBe("premium_paid");
    }
    expect((await store.getPolicy(policy.id))?.status).toBe("premium_paid");
  });

  it("lists all saved policies", async () => {
    const first = { ...quotePolicy(demoCoverageRequest), id: "policy-a" };
    const second = { ...quotePolicy(demoCoverageRequest), id: "policy-b" };
    await store.savePolicy(first);
    await store.savePolicy(second);

    const ids = (await store.listPolicies()).map((p) => p.id).sort();
    expect(ids).toEqual(["policy-a", "policy-b"]);
  });
});
