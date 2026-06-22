import type {
  AuditSnapshot,
  OperatorReviewItem,
  PaymentEvent,
  Policy,
  PolicyLedgerSnapshot,
  WorkflowEvent
} from "./types";
import { buildOperatorReviewQueue } from "./operator-review";
import type { PricingJob } from "./pricing-job";

/**
 * Thrown when a write violates one of the ledger's uniqueness invariants
 * (duplicate payment event, second payout request/issue, duplicate audit
 * snapshot). The Postgres store raises this on a `23505` unique-constraint
 * violation; the in-memory store raises it from its equivalent checks. The
 * idempotent-retry wrapper keys off this type to re-run an operation whose
 * transaction lost a race, after which the read-check fast path returns a
 * replay instead of re-inserting.
 */
export class DuplicateEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateEventError";
  }
}

/**
 * Re-run a money operation once if its transaction lost a uniqueness race.
 * On the second pass the handler's read-check fast path finds the now-committed
 * event and returns an idempotent replay instead of inserting again. A no-op
 * for the single-threaded in-memory store, which never races.
 */
export async function runIdempotent<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof DuplicateEventError) {
      return fn();
    }
    throw error;
  }
}

export interface PolicyStore {
  savePolicy(policy: Policy): Promise<void>;
  getPolicy(policyId: string): Promise<Policy | undefined>;
  appendWorkflowEvent(event: WorkflowEvent): Promise<void>;
  appendPaymentEvent(event: PaymentEvent): Promise<void>;
  appendAuditSnapshot(snapshot: AuditSnapshot): Promise<void>;
  getAuditSnapshot(snapshotId: string): Promise<AuditSnapshot | undefined>;
  findPaymentEvent(policyId: string, kind: PaymentEvent["kind"], reference: string): Promise<PaymentEvent | undefined>;
  /** Find a payment event by its Stripe Event Identity (evt_…) — canonical webhook idempotency. */
  findPaymentEventByIdentity(policyId: string, eventIdentity: string): Promise<PaymentEvent | undefined>;
  hasPayout(policyId: string): Promise<boolean>;
  /**
   * Run `fn` inside a single atomic unit of work. Every write performed via the
   * `tx` store commits together or rolls back together. Money-mutating
   * operations MUST go through this so a crash or duplicate webhook cannot leave
   * a torn write (e.g. payment recorded but policy status not advanced).
   */
  withTransaction<T>(fn: (tx: PolicyStore) => Promise<T>): Promise<T>;
  /**
   * Full ledger load. Batch/test/admin use only — never call on a per-request
   * route; it scans every table. Production routes use `snapshotForPolicy` or
   * `getOperatorReviewQueue`.
   */
  snapshot(): Promise<PolicyLedgerSnapshot>;
  /** Ledger scoped to a single policy (indexed by policy_id) — for audit and per-policy consistency. */
  snapshotForPolicy(policyId: string): Promise<PolicyLedgerSnapshot>;
  /** Operator review queue built from targeted queries rather than a full ledger load. */
  getOperatorReviewQueue(): Promise<OperatorReviewItem[]>;
  /** All policy rows, no events — the lightweight query behind the operator list. */
  listPolicies(): Promise<Policy[]>;
  savePricingJob(job: PricingJob): Promise<void>;
  getPricingJob(quoteId: string): Promise<PricingJob | undefined>;
  listPendingPricingJobs(since?: string): Promise<PricingJob[]>;
}

export class InMemoryPolicyStore implements PolicyStore {
  private readonly policies = new Map<string, Policy>();
  private readonly workflowEvents: WorkflowEvent[] = [];
  private readonly paymentEvents: PaymentEvent[] = [];
  private readonly auditSnapshots: AuditSnapshot[] = [];
  private readonly pricingJobs = new Map<string, PricingJob>();

  async savePolicy(policy: Policy): Promise<void> {
    this.policies.set(policy.id, structuredClone(policy));
  }

  async getPolicy(policyId: string): Promise<Policy | undefined> {
    const policy = this.policies.get(policyId);
    return policy ? structuredClone(policy) : undefined;
  }

  async appendWorkflowEvent(event: WorkflowEvent): Promise<void> {
    this.workflowEvents.push(structuredClone(event));
  }

  async appendPaymentEvent(event: PaymentEvent): Promise<void> {
    const existing = await this.findPaymentEvent(event.policyId, event.kind, event.reference);
    if (existing) {
      throw new DuplicateEventError("Policy store blocked duplicate payment event.");
    }

    if (event.eventIdentity && (await this.findPaymentEventByIdentity(event.policyId, event.eventIdentity))) {
      throw new DuplicateEventError("Policy store blocked duplicate event identity.");
    }

    if (event.kind === "payout_requested" && (await this.hasPayoutRequest(event.policyId))) {
      throw new DuplicateEventError("Policy store blocked duplicate payout request event.");
    }

    if (event.kind === "payout_issued" && (await this.hasPayout(event.policyId))) {
      throw new DuplicateEventError("Policy store blocked duplicate payout event.");
    }

    this.paymentEvents.push(structuredClone(event));
  }

  async appendAuditSnapshot(snapshot: AuditSnapshot): Promise<void> {
    if (await this.getAuditSnapshot(snapshot.id)) {
      throw new DuplicateEventError("Policy store blocked duplicate audit snapshot.");
    }

    this.auditSnapshots.push(structuredClone(snapshot));
  }

  async getAuditSnapshot(snapshotId: string): Promise<AuditSnapshot | undefined> {
    const snapshot = this.auditSnapshots.find((candidate) => candidate.id === snapshotId);
    return snapshot ? structuredClone(snapshot) : undefined;
  }

  async findPaymentEvent(
    policyId: string,
    kind: PaymentEvent["kind"],
    reference: string
  ): Promise<PaymentEvent | undefined> {
    const event = this.paymentEvents.find(
      (candidate) =>
        candidate.policyId === policyId && candidate.kind === kind && candidate.reference === reference
    );
    return event ? structuredClone(event) : undefined;
  }

  async findPaymentEventByIdentity(
    policyId: string,
    eventIdentity: string
  ): Promise<PaymentEvent | undefined> {
    const event = this.paymentEvents.find(
      (candidate) => candidate.policyId === policyId && candidate.eventIdentity === eventIdentity
    );
    return event ? structuredClone(event) : undefined;
  }

  async hasPayout(policyId: string): Promise<boolean> {
    return this.paymentEvents.some(
      (event) => event.policyId === policyId && event.kind === "payout_issued"
    );
  }

  async hasPayoutRequest(policyId: string): Promise<boolean> {
    return this.paymentEvents.some(
      (event) => event.policyId === policyId && event.kind === "payout_requested"
    );
  }

  async withTransaction<T>(fn: (tx: PolicyStore) => Promise<T>): Promise<T> {
    // Single-threaded staging copy: capture current contents, run the unit of
    // work against `this`, and restore on failure so a thrown error leaves no
    // partial writes — mirroring the BEGIN/ROLLBACK semantics of the SQL store.
    const policiesBackup = new Map(this.policies);
    const workflowBackup = [...this.workflowEvents];
    const paymentBackup = [...this.paymentEvents];
    const auditBackup = [...this.auditSnapshots];
    const pricingJobsBackup = new Map(this.pricingJobs);
    try {
      return await fn(this);
    } catch (error) {
      this.policies.clear();
      for (const [id, policy] of policiesBackup) {
        this.policies.set(id, policy);
      }
      this.workflowEvents.length = 0;
      this.workflowEvents.push(...workflowBackup);
      this.paymentEvents.length = 0;
      this.paymentEvents.push(...paymentBackup);
      this.auditSnapshots.length = 0;
      this.auditSnapshots.push(...auditBackup);
      this.pricingJobs.clear();
      for (const [id, j] of pricingJobsBackup) this.pricingJobs.set(id, j);
      throw error;
    }
  }

  async savePricingJob(job: PricingJob): Promise<void> {
    this.pricingJobs.set(job.quoteId, structuredClone(job));
  }

  async getPricingJob(quoteId: string): Promise<PricingJob | undefined> {
    const job = this.pricingJobs.get(quoteId);
    return job ? structuredClone(job) : undefined;
  }

  async listPendingPricingJobs(since?: string): Promise<PricingJob[]> {
    return Array.from(this.pricingJobs.values())
      .filter((job) => job.status === "pending" && (since === undefined || job.createdAt > since))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((job) => structuredClone(job));
  }

  async snapshot(): Promise<PolicyLedgerSnapshot> {
    return {
      policies: Array.from(this.policies.values()).map((policy) => structuredClone(policy)),
      workflowEvents: this.workflowEvents.map((event) => structuredClone(event)),
      paymentEvents: this.paymentEvents.map((event) => structuredClone(event)),
      auditSnapshots: this.auditSnapshots.map((snapshot) => structuredClone(snapshot))
    };
  }

  async snapshotForPolicy(policyId: string): Promise<PolicyLedgerSnapshot> {
    const policy = this.policies.get(policyId);
    return {
      policies: policy ? [structuredClone(policy)] : [],
      workflowEvents: this.workflowEvents
        .filter((event) => event.policyId === policyId)
        .map((event) => structuredClone(event)),
      paymentEvents: this.paymentEvents
        .filter((event) => event.policyId === policyId)
        .map((event) => structuredClone(event)),
      auditSnapshots: this.auditSnapshots
        .filter((snapshot) => snapshot.policyId === policyId)
        .map((snapshot) => structuredClone(snapshot))
    };
  }

  async getOperatorReviewQueue(): Promise<OperatorReviewItem[]> {
    return buildOperatorReviewQueue(await this.snapshot());
  }

  async listPolicies(): Promise<Policy[]> {
    return Array.from(this.policies.values()).map((policy) => structuredClone(policy));
  }
}

export function workflowEvent(input: Omit<WorkflowEvent, "id">): WorkflowEvent {
  return {
    id: `wf-${input.policyId}-${input.kind}-${input.at}`,
    ...input
  };
}

export function paymentEvent(input: Omit<PaymentEvent, "id">): PaymentEvent {
  return {
    id: input.providerEventId ?? `pay-${input.policyId}-${input.kind}-${input.reference}`,
    ...input
  };
}
