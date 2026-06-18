import type { AuditSnapshot, PaymentEvent, Policy, PolicyLedgerSnapshot, WorkflowEvent } from "./types";

export interface PolicyStore {
  savePolicy(policy: Policy): Promise<void>;
  getPolicy(policyId: string): Promise<Policy | undefined>;
  appendWorkflowEvent(event: WorkflowEvent): Promise<void>;
  appendPaymentEvent(event: PaymentEvent): Promise<void>;
  appendAuditSnapshot(snapshot: AuditSnapshot): Promise<void>;
  getAuditSnapshot(snapshotId: string): Promise<AuditSnapshot | undefined>;
  findPaymentEvent(policyId: string, kind: PaymentEvent["kind"], reference: string): Promise<PaymentEvent | undefined>;
  hasPayout(policyId: string): Promise<boolean>;
  snapshot(): Promise<PolicyLedgerSnapshot>;
}

export class InMemoryPolicyStore implements PolicyStore {
  private readonly policies = new Map<string, Policy>();
  private readonly workflowEvents: WorkflowEvent[] = [];
  private readonly paymentEvents: PaymentEvent[] = [];
  private readonly auditSnapshots: AuditSnapshot[] = [];

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
      throw new Error("Policy store blocked duplicate payment event.");
    }

    if (event.kind === "payout_requested" && (await this.hasPayoutRequest(event.policyId))) {
      throw new Error("Policy store blocked duplicate payout request event.");
    }

    if (event.kind === "payout_issued" && (await this.hasPayout(event.policyId))) {
      throw new Error("Policy store blocked duplicate payout event.");
    }

    this.paymentEvents.push(structuredClone(event));
  }

  async appendAuditSnapshot(snapshot: AuditSnapshot): Promise<void> {
    if (await this.getAuditSnapshot(snapshot.id)) {
      throw new Error("Policy store blocked duplicate audit snapshot.");
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

  async snapshot(): Promise<PolicyLedgerSnapshot> {
    return {
      policies: Array.from(this.policies.values()).map((policy) => structuredClone(policy)),
      workflowEvents: this.workflowEvents.map((event) => structuredClone(event)),
      paymentEvents: this.paymentEvents.map((event) => structuredClone(event)),
      auditSnapshots: this.auditSnapshots.map((snapshot) => structuredClone(snapshot))
    };
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
