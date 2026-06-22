import { sql } from "drizzle-orm";
import { bigserial, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { AuditSnapshot, PaymentEvent, Policy, PolicyStatus, WorkflowEvent } from "../types";

/**
 * Mutable projection. The only table that receives UPDATEs (on status change).
 * `data` holds the full typed Policy; `status` is extracted because it IS the
 * projection and is the only column we query/observe on.
 */
export const policies = pgTable("policies", {
  id: text("id").primaryKey(),
  status: text("status").$type<PolicyStatus>().notNull(),
  data: jsonb("data").$type<Policy>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

/**
 * Append-only log. `seq` gives a stable total order (replaces the implicit
 * push-order of the in-memory array). `id` is deterministic
 * (`wf-{policyId}-{kind}-{at}`) and unique for idempotency.
 */
export const workflowEvents = pgTable(
  "workflow_events",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    id: text("id").notNull(),
    policyId: text("policy_id")
      .notNull()
      .references(() => policies.id),
    kind: text("kind").$type<WorkflowEvent["kind"]>().notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    data: jsonb("data").$type<WorkflowEvent>().notNull()
  },
  (table) => [
    uniqueIndex("workflow_events_id_unique").on(table.id),
    index("workflow_events_policy_id_idx").on(table.policyId)
  ]
);

/**
 * Append-only log. Idempotency and the single-payout invariants are enforced
 * by DB constraints (the real guarantee), not by read-then-check:
 *  - unique (policy_id, kind, reference)        — no duplicate event
 *  - partial unique where kind=payout_requested — one request per policy
 *  - partial unique where kind=payout_issued    — one payout per policy
 *  - partial unique on event_identity           — one apply per Stripe event
 */
export const paymentEvents = pgTable(
  "payment_events",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    id: text("id").notNull(),
    policyId: text("policy_id")
      .notNull()
      .references(() => policies.id),
    kind: text("kind").$type<PaymentEvent["kind"]>().notNull(),
    reference: text("reference").notNull(),
    // Stripe Event Identity (evt_…) for Inbound Money Events; null for outbound.
    eventIdentity: text("event_identity"),
    at: timestamp("at", { withTimezone: true }).notNull(),
    data: jsonb("data").$type<PaymentEvent>().notNull()
  },
  (table) => [
    uniqueIndex("payment_events_policy_kind_reference_unique").on(
      table.policyId,
      table.kind,
      table.reference
    ),
    uniqueIndex("payment_events_one_payout_request_per_policy")
      .on(table.policyId)
      .where(sql`kind = 'payout_requested'`),
    uniqueIndex("payment_events_one_payout_per_policy")
      .on(table.policyId)
      .where(sql`kind = 'payout_issued'`),
    uniqueIndex("payment_events_event_identity_unique")
      .on(table.eventIdentity)
      .where(sql`event_identity is not null`),
    index("payment_events_policy_id_idx").on(table.policyId)
  ]
);

export const pricingJobs = pgTable(
  "pricing_jobs",
  {
    quoteId: text("quote_id").primaryKey(),
    status: text("status").$type<"pending" | "priced">().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    data: jsonb("data").$type<import("../pricing-job").PricingJob>().notNull()
  },
  (table) => [index("pricing_jobs_pending_created_idx").on(table.status, table.createdAt)]
);

export const auditSnapshots = pgTable(
  "audit_snapshots",
  {
    seq: bigserial("seq", { mode: "number" }).primaryKey(),
    id: text("id").notNull(),
    policyId: text("policy_id")
      .notNull()
      .references(() => policies.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    data: jsonb("data").$type<AuditSnapshot>().notNull()
  },
  (table) => [
    uniqueIndex("audit_snapshots_id_unique").on(table.id),
    index("audit_snapshots_policy_id_idx").on(table.policyId)
  ]
);
