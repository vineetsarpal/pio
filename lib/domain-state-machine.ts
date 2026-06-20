export const DOMAIN_POLICY_STATES = {
  quoteRequested: "quote_requested",
  quoteGenerated: "quote_generated",
  checkoutCreated: "checkout_created",
  premiumPaid: "premium_paid",
  policyActive: "policy_active",
  policyExpired: "policy_expired"
} as const;

export type DomainPolicyState = (typeof DOMAIN_POLICY_STATES)[keyof typeof DOMAIN_POLICY_STATES];

export const DOMAIN_CLAIM_STATES = {
  triggerDetected: "trigger_detected",
  claimOpened: "claim_opened",
  claimValidated: "claim_validated",
  claimApproved: "claim_approved",
  settlementInitiated: "settlement_initiated",
  settlementCompleted: "settlement_completed",
  claimDenied: "claim_denied",
  noTrigger: "no_trigger"
} as const;

export type DomainClaimState = (typeof DOMAIN_CLAIM_STATES)[keyof typeof DOMAIN_CLAIM_STATES];

type EntityType = "policy" | "claim";
type Evidence = Record<string, unknown>;

export type DomainAuditEvent = {
  id: string;
  actor: string;
  timestamp: string;
  entity: {
    type: EntityType;
    id: string;
  };
  action: DomainPolicyState | DomainClaimState;
  evidence: Evidence;
  previousState: DomainPolicyState | DomainClaimState | null;
  resultingState: DomainPolicyState | DomainClaimState;
};

export type DomainPolicyRecord = {
  id: string;
  quoteId: string;
  state: DomainPolicyState;
  claimIds: string[];
  hasSettledClaim: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DomainClaimRecord = {
  id: string;
  policyId: string;
  state: DomainClaimState;
  evidence: Evidence;
  settlementInitiated: boolean;
  createdAt: string;
  updatedAt: string;
};

export class InvalidDomainTransitionError extends Error {
  constructor(
    readonly entityType: EntityType,
    readonly entityId: string,
    readonly fromState: string,
    readonly toState: string
  ) {
    super(`Invalid ${entityType} transition for ${entityId}: ${fromState} -> ${toState}`);
    this.name = "InvalidDomainTransitionError";
  }
}

export class DuplicateDomainOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateDomainOperationError";
  }
}

export class DomainEntityNotFoundError extends Error {
  constructor(readonly entityType: EntityType, readonly entityId: string) {
    super(`${entityType} not found: ${entityId}`);
    this.name = "DomainEntityNotFoundError";
  }
}

const POLICY_TRANSITIONS: Record<DomainPolicyState, readonly DomainPolicyState[]> = {
  quote_requested: ["quote_generated"],
  quote_generated: ["checkout_created"],
  checkout_created: ["premium_paid"],
  premium_paid: ["policy_active"],
  policy_active: ["policy_expired"],
  policy_expired: []
};

const CLAIM_TRANSITIONS: Record<DomainClaimState, readonly DomainClaimState[]> = {
  trigger_detected: ["claim_opened", "no_trigger"],
  claim_opened: ["claim_validated", "claim_denied"],
  claim_validated: ["claim_approved", "claim_denied"],
  claim_approved: ["settlement_initiated"],
  settlement_initiated: ["settlement_completed"],
  settlement_completed: [],
  claim_denied: [],
  no_trigger: []
};

export function allowedDomainPolicyTransitions(state: DomainPolicyState): DomainPolicyState[] {
  return [...POLICY_TRANSITIONS[state]];
}

export function allowedDomainClaimTransitions(state: DomainClaimState): DomainClaimState[] {
  return [...CLAIM_TRANSITIONS[state]];
}

function publicPolicy(policy: InternalPolicy): DomainPolicyRecord {
  return {
    id: policy.id,
    quoteId: policy.quoteId,
    state: policy.state,
    claimIds: [...policy.claimIds],
    hasSettledClaim: policy.hasSettledClaim,
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt
  };
}

function publicClaim(claim: InternalClaim): DomainClaimRecord {
  return {
    id: claim.id,
    policyId: claim.policyId,
    state: claim.state,
    evidence: { ...claim.evidence },
    settlementInitiated: claim.settlementInitiated,
    createdAt: claim.createdAt,
    updatedAt: claim.updatedAt
  };
}

type InternalPolicy = Omit<DomainPolicyRecord, "claimIds"> & { claimIds: Set<string> };
type InternalClaim = DomainClaimRecord;

export class PioDomainStateMachine {
  private readonly policies = new Map<string, InternalPolicy>();
  private readonly claims = new Map<string, InternalClaim>();
  private readonly now: () => string;
  readonly auditEvents: DomainAuditEvent[] = [];

  constructor({ now = () => new Date().toISOString() }: { now?: () => string } = {}) {
    this.now = now;
  }

  createPolicyQuote({
    policyId,
    quoteId,
    actor = "system",
    evidence = {}
  }: {
    policyId: string;
    quoteId: string;
    actor?: string;
    evidence?: Evidence;
  }): DomainPolicyRecord {
    if (this.policies.has(policyId)) {
      throw new DuplicateDomainOperationError(`Policy already exists: ${policyId}`);
    }

    const timestamp = this.now();
    const policy: InternalPolicy = {
      id: policyId,
      quoteId,
      state: DOMAIN_POLICY_STATES.quoteRequested,
      claimIds: new Set<string>(),
      hasSettledClaim: false,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.policies.set(policyId, policy);
    this.writeAudit({
      actor,
      entityType: "policy",
      entityId: policyId,
      action: DOMAIN_POLICY_STATES.quoteRequested,
      evidence: { quoteId, ...evidence },
      previousState: null,
      resultingState: DOMAIN_POLICY_STATES.quoteRequested
    });

    return publicPolicy(policy);
  }

  generateQuote(policyId: string, options: TransitionOptions = {}): DomainPolicyRecord {
    return this.transitionPolicy(policyId, DOMAIN_POLICY_STATES.quoteGenerated, options);
  }

  createCheckout(policyId: string, options: TransitionOptions = {}): DomainPolicyRecord {
    return this.transitionPolicy(policyId, DOMAIN_POLICY_STATES.checkoutCreated, options);
  }

  markPremiumPaid(policyId: string, options: TransitionOptions = {}): DomainPolicyRecord {
    return this.transitionPolicy(policyId, DOMAIN_POLICY_STATES.premiumPaid, options);
  }

  activatePolicy(policyId: string, options: TransitionOptions = {}): DomainPolicyRecord {
    return this.transitionPolicy(policyId, DOMAIN_POLICY_STATES.policyActive, options);
  }

  expirePolicy(policyId: string, options: TransitionOptions = {}): DomainPolicyRecord {
    return this.transitionPolicy(policyId, DOMAIN_POLICY_STATES.policyExpired, options);
  }

  detectTrigger(
    policyId: string,
    { actor = "weather_oracle", evidence = {} }: TransitionOptions = {}
  ): DomainClaimRecord {
    const policy = this.requirePolicy(policyId);
    if (policy.state !== DOMAIN_POLICY_STATES.policyActive) {
      throw new InvalidDomainTransitionError(
        "claim",
        `auto_${policyId}`,
        `policy_${policy.state}`,
        DOMAIN_CLAIM_STATES.triggerDetected
      );
    }
    if (policy.claimIds.size > 0 || policy.hasSettledClaim) {
      throw new DuplicateDomainOperationError(`Policy ${policyId} already has a claim or trigger decision.`);
    }

    const timestamp = this.now();
    const claimId = `auto_${policyId}`;
    const state = evidence.triggerMet === false ? DOMAIN_CLAIM_STATES.noTrigger : DOMAIN_CLAIM_STATES.triggerDetected;
    const claim: InternalClaim = {
      id: claimId,
      policyId,
      state,
      evidence: { ...evidence },
      settlementInitiated: false,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.claims.set(claimId, claim);
    policy.claimIds.add(claimId);
    this.writeAudit({
      actor,
      entityType: "claim",
      entityId: claimId,
      action: state,
      evidence: { policyId, ...evidence },
      previousState: null,
      resultingState: state
    });

    return publicClaim(claim);
  }

  openClaim(claimId: string, { actor = "hermes_agent", evidence = {} }: TransitionOptions = {}): DomainClaimRecord {
    const policyId = evidence.policyId;
    if (typeof policyId !== "string" || !policyId) {
      throw new Error("policyId evidence is required to open a claim.");
    }

    const policy = this.requirePolicy(policyId);
    if (policy.state !== DOMAIN_POLICY_STATES.policyActive) {
      throw new InvalidDomainTransitionError("claim", claimId, `policy_${policy.state}`, DOMAIN_CLAIM_STATES.claimOpened);
    }
    if (policy.hasSettledClaim || [...policy.claimIds].some((id) => this.claims.get(id)?.state === DOMAIN_CLAIM_STATES.noTrigger)) {
      throw new DuplicateDomainOperationError(`Policy ${policyId} already has a terminal claim decision.`);
    }
    if (this.claims.has(claimId)) {
      throw new DuplicateDomainOperationError(`Claim already exists: ${claimId}`);
    }

    const autoTriggerId = [...policy.claimIds].find((id) => this.claims.get(id)?.state === DOMAIN_CLAIM_STATES.triggerDetected);
    if (!autoTriggerId) {
      throw new InvalidDomainTransitionError("claim", claimId, "no_trigger_detected", DOMAIN_CLAIM_STATES.claimOpened);
    }

    const trigger = this.requireClaim(autoTriggerId);
    this.claims.delete(autoTriggerId);
    policy.claimIds.delete(autoTriggerId);

    const claim: InternalClaim = {
      ...trigger,
      id: claimId,
      state: DOMAIN_CLAIM_STATES.claimOpened,
      evidence: { ...trigger.evidence, ...evidence },
      updatedAt: this.now()
    };
    this.claims.set(claimId, claim);
    policy.claimIds.add(claimId);

    this.writeAudit({
      actor,
      entityType: "claim",
      entityId: claimId,
      action: DOMAIN_CLAIM_STATES.claimOpened,
      evidence,
      previousState: DOMAIN_CLAIM_STATES.triggerDetected,
      resultingState: DOMAIN_CLAIM_STATES.claimOpened
    });

    return publicClaim(claim);
  }

  validateClaim(claimId: string, options: TransitionOptions = {}): DomainClaimRecord {
    return this.transitionClaim(claimId, DOMAIN_CLAIM_STATES.claimValidated, options);
  }

  approveClaim(claimId: string, options: TransitionOptions = {}): DomainClaimRecord {
    return this.transitionClaim(claimId, DOMAIN_CLAIM_STATES.claimApproved, options);
  }

  denyClaim(claimId: string, options: TransitionOptions = {}): DomainClaimRecord {
    return this.transitionClaim(claimId, DOMAIN_CLAIM_STATES.claimDenied, options);
  }

  initiateSettlement(claimId: string, options: TransitionOptions = {}): DomainClaimRecord {
    const claim = this.requireClaim(claimId);
    const policy = this.requirePolicy(claim.policyId);
    if (policy.hasSettledClaim || claim.settlementInitiated) {
      throw new DuplicateDomainOperationError(`Settlement already exists for claim ${claimId}.`);
    }

    const transitioned = this.transitionClaim(claimId, DOMAIN_CLAIM_STATES.settlementInitiated, options);
    this.requireClaim(claimId).settlementInitiated = true;
    return transitioned;
  }

  completeSettlement(claimId: string, options: TransitionOptions = {}): DomainClaimRecord {
    const transitioned = this.transitionClaim(claimId, DOMAIN_CLAIM_STATES.settlementCompleted, options);
    const claim = this.requireClaim(claimId);
    this.requirePolicy(claim.policyId).hasSettledClaim = true;
    return transitioned;
  }

  getPolicy(policyId: string): DomainPolicyRecord {
    return publicPolicy(this.requirePolicy(policyId));
  }

  getClaim(claimId: string): DomainClaimRecord {
    return publicClaim(this.requireClaim(claimId));
  }

  private transitionPolicy(policyId: string, nextState: DomainPolicyState, { actor = "system", evidence = {} }: TransitionOptions): DomainPolicyRecord {
    const policy = this.requirePolicy(policyId);
    const previousState = policy.state;
    if (!POLICY_TRANSITIONS[previousState].includes(nextState)) {
      throw new InvalidDomainTransitionError("policy", policyId, previousState, nextState);
    }

    policy.state = nextState;
    policy.updatedAt = this.now();
    this.writeAudit({
      actor,
      entityType: "policy",
      entityId: policyId,
      action: nextState,
      evidence,
      previousState,
      resultingState: nextState
    });

    return publicPolicy(policy);
  }

  private transitionClaim(claimId: string, nextState: DomainClaimState, { actor = "system", evidence = {} }: TransitionOptions): DomainClaimRecord {
    const claim = this.requireClaim(claimId);
    const previousState = claim.state;
    if (!CLAIM_TRANSITIONS[previousState].includes(nextState)) {
      throw new InvalidDomainTransitionError("claim", claimId, previousState, nextState);
    }

    claim.state = nextState;
    claim.evidence = { ...claim.evidence, ...evidence };
    claim.updatedAt = this.now();
    this.writeAudit({
      actor,
      entityType: "claim",
      entityId: claimId,
      action: nextState,
      evidence,
      previousState,
      resultingState: nextState
    });

    return publicClaim(claim);
  }

  private requirePolicy(policyId: string): InternalPolicy {
    const policy = this.policies.get(policyId);
    if (!policy) {
      throw new DomainEntityNotFoundError("policy", policyId);
    }
    return policy;
  }

  private requireClaim(claimId: string): InternalClaim {
    const claim = this.claims.get(claimId);
    if (!claim) {
      throw new DomainEntityNotFoundError("claim", claimId);
    }
    return claim;
  }

  private writeAudit({
    actor,
    entityType,
    entityId,
    action,
    evidence,
    previousState,
    resultingState
  }: {
    actor: string;
    entityType: EntityType;
    entityId: string;
    action: DomainAuditEvent["action"];
    evidence: Evidence;
    previousState: DomainAuditEvent["previousState"];
    resultingState: DomainAuditEvent["resultingState"];
  }): void {
    this.auditEvents.push({
      id: `aud_${String(this.auditEvents.length + 1).padStart(6, "0")}`,
      actor,
      timestamp: this.now(),
      entity: { type: entityType, id: entityId },
      action,
      evidence: { ...evidence },
      previousState,
      resultingState
    });
  }
}

type TransitionOptions = {
  actor?: string;
  evidence?: Evidence;
};
