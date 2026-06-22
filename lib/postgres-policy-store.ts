import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { auditSnapshots, paymentEvents, policies, workflowEvents } from "./db/schema";
import { buildOperatorReviewQueue } from "./operator-review";
import { DuplicateEventError, type PolicyStore } from "./policy-store";
import type {
  AuditSnapshot,
  OperatorReviewItem,
  PaymentEvent,
  Policy,
  PolicyLedgerSnapshot,
  WorkflowEvent
} from "./types";

/**
 * Any Drizzle pg database handle — the root client or a transaction handle.
 * Both expose the same query-builder surface, which lets the store run
 * unchanged inside or outside a transaction (and against neon-serverless in
 * production or PGlite in tests).
 */
type DrizzleDb = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

const POSTGRES_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(error: unknown): boolean {
  // Drizzle wraps driver errors ("Failed query: …") and hangs the original pg
  // error — which carries the SQLSTATE — off `.cause`, so walk the chain.
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current !== "object" || current === null) break;
    if ((current as { code?: unknown }).code === POSTGRES_UNIQUE_VIOLATION) return true;
    const message = (current as { message?: unknown }).message;
    if (typeof message === "string" && /duplicate key value|unique constraint/i.test(message)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export class PostgresPolicyStore implements PolicyStore {
  constructor(
    private readonly db: DrizzleDb,
    private readonly inTransaction = false
  ) {}

  async savePolicy(policy: Policy): Promise<void> {
    await this.db
      .insert(policies)
      .values({ id: policy.id, status: policy.status, data: policy })
      .onConflictDoUpdate({
        target: policies.id,
        set: { status: policy.status, data: policy, updatedAt: new Date() }
      });
  }

  async getPolicy(policyId: string): Promise<Policy | undefined> {
    const rows = await this.db
      .select({ data: policies.data })
      .from(policies)
      .where(eq(policies.id, policyId))
      .limit(1);
    return rows[0]?.data;
  }

  async appendWorkflowEvent(event: WorkflowEvent): Promise<void> {
    // Deterministic id (`wf-{policyId}-{kind}-{at}`) makes re-appends idempotent;
    // mirrors the in-memory push, which never duplicates a logical event.
    await this.db
      .insert(workflowEvents)
      .values({
        id: event.id,
        policyId: event.policyId,
        kind: event.kind,
        at: new Date(event.at),
        data: event
      })
      .onConflictDoNothing({ target: workflowEvents.id });
  }

  async appendPaymentEvent(event: PaymentEvent): Promise<void> {
    // Uniqueness invariants are enforced by DB constraints (the real guarantee):
    // unique(policy_id, kind, reference) and the partial unique indexes for one
    // payout request / one payout per policy. A violation becomes a typed error
    // the idempotent-retry wrapper understands.
    try {
      await this.db.insert(paymentEvents).values({
        id: event.id,
        policyId: event.policyId,
        kind: event.kind,
        reference: event.reference,
        eventIdentity: event.eventIdentity ?? null,
        at: new Date(event.at),
        data: event
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateEventError("Policy store blocked duplicate payout/payment event.");
      }
      throw error;
    }
  }

  async appendAuditSnapshot(snapshot: AuditSnapshot): Promise<void> {
    try {
      await this.db.insert(auditSnapshots).values({
        id: snapshot.id,
        policyId: snapshot.policyId,
        createdAt: new Date(snapshot.createdAt),
        data: snapshot
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DuplicateEventError("Policy store blocked duplicate audit snapshot.");
      }
      throw error;
    }
  }

  async getAuditSnapshot(snapshotId: string): Promise<AuditSnapshot | undefined> {
    const rows = await this.db
      .select({ data: auditSnapshots.data })
      .from(auditSnapshots)
      .where(eq(auditSnapshots.id, snapshotId))
      .limit(1);
    return rows[0]?.data;
  }

  async findPaymentEvent(
    policyId: string,
    kind: PaymentEvent["kind"],
    reference: string
  ): Promise<PaymentEvent | undefined> {
    const rows = await this.db
      .select({ data: paymentEvents.data })
      .from(paymentEvents)
      .where(
        and(
          eq(paymentEvents.policyId, policyId),
          eq(paymentEvents.kind, kind),
          eq(paymentEvents.reference, reference)
        )
      )
      .limit(1);
    return rows[0]?.data;
  }

  async findPaymentEventByIdentity(
    policyId: string,
    eventIdentity: string
  ): Promise<PaymentEvent | undefined> {
    const rows = await this.db
      .select({ data: paymentEvents.data })
      .from(paymentEvents)
      .where(and(eq(paymentEvents.policyId, policyId), eq(paymentEvents.eventIdentity, eventIdentity)))
      .limit(1);
    return rows[0]?.data;
  }

  async hasPayout(policyId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: paymentEvents.id })
      .from(paymentEvents)
      .where(and(eq(paymentEvents.policyId, policyId), eq(paymentEvents.kind, "payout_issued")))
      .limit(1);
    return rows.length > 0;
  }

  async withTransaction<T>(fn: (tx: PolicyStore) => Promise<T>): Promise<T> {
    // Already inside a transaction: reuse it (handlers never nest, but this keeps
    // the contract total). Otherwise open a real BEGIN/COMMIT and bind a
    // transaction-scoped store so every write commits or rolls back together.
    if (this.inTransaction) {
      return fn(this);
    }
    return this.db.transaction(async (txDb) =>
      fn(new PostgresPolicyStore(txDb as unknown as DrizzleDb, true))
    );
  }

  async snapshot(): Promise<PolicyLedgerSnapshot> {
    // Batch/test/admin only — full table scans. Production routes use the
    // scoped methods below.
    const [policyRows, workflowRows, paymentRows, auditRows] = await Promise.all([
      this.db.select({ data: policies.data }).from(policies).orderBy(asc(policies.id)),
      this.db.select({ data: workflowEvents.data }).from(workflowEvents).orderBy(asc(workflowEvents.seq)),
      this.db.select({ data: paymentEvents.data }).from(paymentEvents).orderBy(asc(paymentEvents.seq)),
      this.db.select({ data: auditSnapshots.data }).from(auditSnapshots).orderBy(asc(auditSnapshots.seq))
    ]);
    return {
      policies: policyRows.map((row) => row.data),
      workflowEvents: workflowRows.map((row) => row.data),
      paymentEvents: paymentRows.map((row) => row.data),
      auditSnapshots: auditRows.map((row) => row.data)
    };
  }

  async snapshotForPolicy(policyId: string): Promise<PolicyLedgerSnapshot> {
    const [policyRows, workflowRows, paymentRows, auditRows] = await Promise.all([
      this.db.select({ data: policies.data }).from(policies).where(eq(policies.id, policyId)),
      this.db
        .select({ data: workflowEvents.data })
        .from(workflowEvents)
        .where(eq(workflowEvents.policyId, policyId))
        .orderBy(asc(workflowEvents.seq)),
      this.db
        .select({ data: paymentEvents.data })
        .from(paymentEvents)
        .where(eq(paymentEvents.policyId, policyId))
        .orderBy(asc(paymentEvents.seq)),
      this.db
        .select({ data: auditSnapshots.data })
        .from(auditSnapshots)
        .where(eq(auditSnapshots.policyId, policyId))
        .orderBy(asc(auditSnapshots.seq))
    ]);
    return {
      policies: policyRows.map((row) => row.data),
      workflowEvents: workflowRows.map((row) => row.data),
      paymentEvents: paymentRows.map((row) => row.data),
      auditSnapshots: auditRows.map((row) => row.data)
    };
  }

  async getOperatorReviewQueue(): Promise<OperatorReviewItem[]> {
    // Targeted queries instead of a full ledger load: the policies under manual
    // review (+ their manual-review workflow events) and the payout failures
    // (+ the policies they reference). Assembled into a minimal ledger so the
    // existing pure builder produces identical items.
    const [manualPolicyRows, manualEventRows, failedEventRows] = await Promise.all([
      this.db.select({ data: policies.data }).from(policies).where(eq(policies.status, "manual_review")),
      this.db
        .select({ data: workflowEvents.data })
        .from(workflowEvents)
        .where(eq(workflowEvents.kind, "manual_review"))
        .orderBy(asc(workflowEvents.seq)),
      this.db
        .select({ data: paymentEvents.data })
        .from(paymentEvents)
        .where(eq(paymentEvents.kind, "payout_failed"))
        .orderBy(asc(paymentEvents.seq))
    ]);

    const manualPolicies = manualPolicyRows.map((row) => row.data);
    const failedEvents = failedEventRows.map((row) => row.data);

    const referencedIds = new Set<string>([
      ...manualPolicies.map((policy) => policy.id),
      ...failedEvents.map((event) => event.policyId)
    ]);
    const knownIds = new Set(manualPolicies.map((policy) => policy.id));
    const missingIds = [...referencedIds].filter((id) => !knownIds.has(id));

    const extraPolicies = missingIds.length
      ? (
          await this.db
            .select({ data: policies.data })
            .from(policies)
            .where(inArray(policies.id, missingIds))
        ).map((row) => row.data)
      : [];

    const ledger: PolicyLedgerSnapshot = {
      policies: [...manualPolicies, ...extraPolicies],
      workflowEvents: manualEventRows.map((row) => row.data),
      paymentEvents: failedEvents,
      auditSnapshots: []
    };
    return buildOperatorReviewQueue(ledger);
  }

  async listPolicies(): Promise<Policy[]> {
    const rows = await this.db
      .select({ data: policies.data })
      .from(policies)
      .orderBy(desc(policies.updatedAt));
    return rows.map((row) => row.data);
  }

  // Scaffolding stubs for Task 5 (Postgres PricingJob schema + migration).
  // These satisfy the PolicyStore interface until the real implementation lands.
  async savePricingJob(): Promise<void> {
    throw new Error("savePricingJob not implemented until Task 5");
  }
  async getPricingJob(): Promise<undefined> {
    throw new Error("getPricingJob not implemented until Task 5");
  }
  async listPendingPricingJobs(): Promise<never[]> {
    throw new Error("listPendingPricingJobs not implemented until Task 5");
  }
}
