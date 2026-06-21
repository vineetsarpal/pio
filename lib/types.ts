export type Money = {
  amount: number;
  currency: "USD";
};

export type PolicyStatus =
  | "quote_requested"
  | "weather_risk_checked"
  | "policy_quoted"
  | "premium_paid"
  | "policy_issued"
  | "monitoring_active"
  | "trigger_data_received"
  | "trigger_evaluated"
  | "claim_approved"
  | "manual_review"
  | "not_triggered"
  | "payout_issued"
  | "audit_generated";

export type CoverageRequest = {
  customerName: string;
  eventName: string;
  locationName: string;
  latitude: number;
  longitude: number;
  eventStart: string;
  eventEnd: string;
  desiredPayout: Money;
  maximumPremium?: Money;
};

export type CoverageProductId = "rain_event" | "flight_delay";

export type AgentCoverageRequest = CoverageRequest & {
  agentId: string;
  purchaseIntent: "quote_only" | "buy_if_within_budget";
};

export type AgentCoverageRejectionCode =
  | "premium_cap_exceeded"
  | "unsupported_currency"
  | "unsupported_purchase_intent"
  | "invalid_request";

export type AgentCoverageResponse =
  | {
      accepted: true;
      reasonCode: "quote_ready";
      agentId: string;
      policy: Policy;
      nextAction: "present_quote" | "create_checkout";
      constraints: {
        maximumPremium?: Money;
        premiumWithinBudget: boolean;
      };
    }
  | {
      accepted: false;
      reasonCode: AgentCoverageRejectionCode;
      agentId?: string;
      message: string;
      constraints?: {
        maximumPremium?: Money;
        quotedPremium?: Money;
      };
    };

export type AgentPurchaseConfirmationRequest = {
  agentId: string;
  quoteId: string;
  idempotencyKey: string;
  authorization: "confirm_purchase";
  coverageRequest: CoverageRequest;
  maximumPremium: Money;
};

export type AgentPurchaseRejectionCode =
  | "invalid_request"
  | "authorization_required"
  | "quote_not_found"
  | "quote_mismatch"
  | "premium_cap_exceeded"
  | "idempotency_conflict";

export type AgentPurchaseConfirmationResponse =
  | {
      accepted: true;
      reasonCode: "checkout_created";
      agentId: string;
      quoteId: string;
      idempotencyKey: string;
      idempotentReplay: boolean;
      policy: Policy;
      checkout: CheckoutSession;
      nextAction: "complete_stripe_checkout";
    }
  | {
      accepted: false;
      reasonCode: AgentPurchaseRejectionCode;
      agentId?: string;
      quoteId?: string;
      idempotencyKey?: string;
      message: string;
      constraints?: {
        maximumPremium?: Money;
        quotedPremium?: Money;
      };
    };

export type TriggerRule = {
  variable: "rainfall_mm" | "arrival_delay_minutes";
  operator: ">";
  threshold: number;
  aggregation: "sum" | "max";
  window: {
    start: string;
    end: string;
  };
};

export type WeatherObservation = {
  observedAt: string;
  rainfallMm: number | null;
};

export type MissingDataPolicy = "fail_closed_manual_review";

export type WeatherEvidenceMetadata = {
  settlementGrade: boolean;
  advisoryOnly: boolean;
  snapshotId: string;
  capturedAt: string;
  sourceUrl: string;
  requestParams: Record<string, string>;
  normalizationVersion: string;
  missingDataPolicy: MissingDataPolicy;
  missingObservationCount: number;
};

export type WeatherEvidence = {
  source: "demo_replay" | "open_meteo";
  metadata: WeatherEvidenceMetadata;
  observations: WeatherObservation[];
};

export type PaymentMode = "stripe_test_mode" | "simulated";

export type PaymentCustomer = {
  id: string;
  name: string;
};

export type CheckoutSession = {
  id: string;
  url: string;
  premium: Money;
  mode: PaymentMode;
};

export type PaymentVerification = {
  paid: boolean;
  paymentReference: string;
  paidAt: string;
};

export type PayoutResult = {
  paid: boolean;
  payoutReference?: string;
  paidAt?: string;
  blockedReason?: string;
};

export type Policy = {
  id: string;
  certificateId: string;
  productId?: CoverageProductId;
  customerName: string;
  eventName: string;
  locationName: string;
  premium: Money;
  coverageAmount?: Money;
  deductible?: Money;
  payout: Money;
  trigger: TriggerRule;
  weatherOracleSource: WeatherEvidence["source"];
  riskSource?: string;
  riskScore?: number;
  riskFactors?: string[];
  status: PolicyStatus;
  stripePaymentReference?: string;
  stripePayoutReference?: string;
  paidAt?: string;
  issuedAt?: string;
  settledAt?: string;
};

export type TriggerDecision = {
  approved: boolean;
  manualReviewRequired: boolean;
  rainfallTotalMm: number;
  thresholdMm: number;
  reason: string;
};

export type SettlementResult = {
  policy: Policy;
  decision: TriggerDecision;
  payoutReference?: string;
};

export type AuditReport = {
  id: string;
  status: "draft" | "final";
  generatedAt: string;
  finalizedAt?: string;
  sourceEventCount: number;
  summary: string;
  facts: string[];
};

export type AuditSnapshot = {
  id: string;
  policyId: string;
  report: AuditReport;
  createdAt: string;
  sourceEventCount: number;
  immutable: true;
};

export type OperatorReviewReason = "manual_weather_review" | "payout_failed";

export type OperatorReviewItem = {
  id: string;
  policyId: string;
  createdAt: string;
  reason: OperatorReviewReason;
  severity: "high" | "medium";
  status: "open";
  title: string;
  summary: string;
  nextAction: string;
  sourceEventId?: string;
};

export type LedgerConsistencyCheck = {
  policyId: string;
  currentStatus: PolicyStatus;
  projectedStatus?: PolicyStatus;
  sourceEventId?: string;
  consistent: boolean;
  message: string;
};

export type LedgerConsistencyReport = {
  consistent: boolean;
  checks: LedgerConsistencyCheck[];
};

export type GaugeAction = {
  id: string;
  at: string;
  actor: "Gauge" | "PIO deterministic engine" | "Stripe Skill" | "Weather oracle";
  action: string;
  detail: string;
  status: "complete" | "blocked" | "pending";
};

export type WorkflowEventKind =
  | "coverage_requested"
  | "policy_quoted"
  | "stripe_customer_created"
  | "stripe_checkout_created"
  | "premium_verified"
  | "policy_issued"
  | "monitoring_started"
  | "weather_checked"
  | "trigger_data_received"
  | "trigger_evaluated"
  | "claim_approved"
  | "payout_requested"
  | "manual_review"
  | "claim_not_triggered"
  | "payout_failed"
  | "payout_issued"
  | "audit_generated";

export type WorkflowEvent = {
  id: string;
  policyId: string;
  at: string;
  kind: WorkflowEventKind;
  actor: GaugeAction["actor"];
  summary: string;
  data: Record<string, unknown>;
};

export type PaymentEvent = {
  id: string;
  policyId: string;
  at: string;
  kind: "premium_collected" | "payout_requested" | "payout_issued" | "payout_failed";
  reference: string;
  amount: Money;
  mode: PaymentMode;
  providerEventId?: string;
  /**
   * The Stripe event id (`evt_…`) for an Inbound Money Event — its Event
   * Identity, used as the canonical idempotency key. Unset for outbound events
   * (e.g. payout_requested), which dedup on (kind, reference).
   */
  eventIdentity?: string;
  failureReason?: string;
};

export type PremiumCollectedEvent = {
  providerEventId: string;
  checkoutId: string;
  policyId: string;
  amount: Money;
  mode: PaymentMode;
  paidAt: string;
};

export type LedgerApplyRejectionCode =
  | "policy_not_found"
  | "invalid_policy_state"
  | "premium_amount_mismatch"
  | "premium_currency_mismatch"
  | "payout_amount_mismatch"
  | "payout_currency_mismatch"
  | "payout_not_requested"
  | "payout_already_completed";

/**
 * The single result of applying any money event to the Ledger via
 * `applyLedgerEvent`. Replaces the former per-event result types
 * (premium/payout) which were structurally identical.
 */
export type LedgerApplyResult =
  | {
      accepted: true;
      policy: Policy;
      paymentEvent: PaymentEvent;
      idempotentReplay: boolean;
    }
  | {
      accepted: false;
      reasonCode: LedgerApplyRejectionCode;
      message: string;
    };

export type PolicyIssuanceResult =
  | {
      accepted: true;
      policy: Policy;
      idempotentReplay: boolean;
    }
  | {
      accepted: false;
      reasonCode: "policy_not_found" | "invalid_policy_state";
      message: string;
    };

export type PayoutRequestedEvent = {
  requestId: string;
  policyId: string;
  amount: Money;
  mode: PaymentMode;
  requestedAt: string;
};

export type PayoutCompletedEvent = {
  providerEventId: string;
  requestId: string;
  payoutReference: string;
  policyId: string;
  amount: Money;
  mode: PaymentMode;
  paidAt: string;
};

export type PayoutFailedEvent = {
  providerEventId: string;
  requestId: string;
  policyId: string;
  amount: Money;
  mode: PaymentMode;
  failedAt: string;
  failureReason: string;
};

export type PolicyLedgerSnapshot = {
  policies: Policy[];
  workflowEvents: WorkflowEvent[];
  paymentEvents: PaymentEvent[];
  auditSnapshots: AuditSnapshot[];
};

export type GaugeDemoRun = {
  request: CoverageRequest;
  policy: Policy;
  evidence: WeatherEvidence;
  decision: TriggerDecision;
  settlement: SettlementResult;
  audit: AuditReport;
  auditTrail: AuditReport[];
  operatorReviewQueue: OperatorReviewItem[];
  ledgerConsistency: LedgerConsistencyReport;
  actions: GaugeAction[];
  ledger: PolicyLedgerSnapshot;
};
