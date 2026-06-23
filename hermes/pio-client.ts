/**
 * PioClient — a self-contained HTTP client the VPS Hermes agent uses to drive
 * the PIO platform. Dependency-free (only `fetch`) so this file can be copied
 * straight onto the agent host.
 *
 * Two trust scopes, mirroring the platform:
 *  - Buyer scope (`agentKey` → PIO_AGENT_SEED_KEY): quote and purchase coverage.
 *  - Operator scope (`operatorKey` → PIO_OPERATOR_KEY): run the book — settle
 *    policies and read the review queue.
 *
 * The deterministic invariant lives on the server: this client only *requests*
 * actions (purchase, settlement). Money movement and claim approval are decided
 * by typed functions in PIO, never here.
 */

export type Money = { amount: number; currency: "USD" };

export type CoverageRequestInput = {
  customerName: string;
  eventName: string;
  locationName: string;
  latitude: number;
  longitude: number;
  eventStart: string;
  eventEnd: string;
  desiredPayout: Money;
};

export type RequestCoverageInput = CoverageRequestInput & {
  agentId: string;
  maximumPremium?: Money;
  purchaseIntent: "quote_only" | "buy_if_within_budget";
};

export type ConfirmPurchaseInput = {
  agentId: string;
  quoteId: string;
  idempotencyKey: string;
  authorization: "confirm_purchase";
  coverageRequest: CoverageRequestInput;
  maximumPremium: Money;
};

export type OffSessionPurchaseInput = {
  idempotencyKey: string;
  coverageRequest: CoverageRequestInput;
};

export type RiskMemoInput = {
  riskScore: number;
  evidence: Array<{ url: string; title: string; snippet: string; retrievedAt: string }>;
  factors?: string[];
  toolName: string;
  model?: string;
};

export type DynamicRainInput = {
  productId: "rain_event"; customerName: string; eventName: string; locationName: string;
  latitude: number; longitude: number; eventStart: string; eventEnd: string;
  desiredPayout: Money; deductible?: Money; maximumPremium?: Money;
};

export type DynamicFlightInput = {
  productId: "flight_delay"; customerName: string; passengerName: string; airline: string;
  flightNumber: string; originAirport: string; destinationAirport: string;
  departureTime: string; arrivalTime: string; desiredPayout: Money; deductible?: Money; maximumPremium?: Money;
};

export type DynamicCoverageInput = DynamicRainInput | DynamicFlightInput;

export type ConfirmDynamicInput = { agentId: string; quoteId: string; idempotencyKey: string; authorization: "confirm_purchase"; maximumPremium: Money };

export type PioClientConfig = {
  baseUrl: string;
  agentKey?: string;
  operatorKey?: string;
  /** Injectable for testing; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
};

/** A parsed PIO response. `status` is the HTTP status; `body` the JSON payload. */
export type PioResponse<T = Record<string, unknown>> = { status: number; body: T } & T;

export class PioClient {
  private readonly baseUrl: string;
  private readonly agentKey?: string;
  private readonly operatorKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: PioClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.agentKey = config.agentKey;
    this.operatorKey = config.operatorKey;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
  }

  /** Buyer scope: priced, not-yet-bound quote. Public — no auth required. */
  async requestCoverage(input: RequestCoverageInput) {
    return this.send("POST", "/api/agent/coverage-request", { body: input });
  }

  /** Buyer scope: confirm a quote and create a real Stripe Checkout Session. */
  async confirmPurchase(input: ConfirmPurchaseInput) {
    return this.send("POST", "/api/agent/confirm-purchase", { body: input, key: this.requireAgentKey() });
  }

  /** Buyer scope: headless off-session charge against the agent's vaulted card. */
  async purchaseOffSession(input: OffSessionPurchaseInput) {
    return this.send("POST", "/api/agent/purchase", { body: input, key: this.requireAgentKey() });
  }

  /** Buyer scope: priced-on-demand quote. Public — no key, like requestCoverage. */
  async requestDynamicCoverage(input: DynamicCoverageInput) {
    return this.send("POST", "/api/agent/coverage-request", { body: { pricing: "dynamic", ...input } });
  }

  /** Buyer scope: buy a priced dynamic quote by replaying its stored premium. */
  async confirmDynamicPurchase(input: ConfirmDynamicInput) {
    return this.send("POST", "/api/agent/confirm-dynamic-purchase", { body: input, key: this.requireAgentKey() });
  }

  /** Buyer scope: read a single policy's status and ledger. */
  async getPolicy(policyId: string) {
    return this.send("GET", `/api/agent/policy/${encodeURIComponent(policyId)}`, { key: this.requireAgentKey() });
  }

  /** Operator scope: run deterministic settlement and, on approval, request the payout. */
  async settlePolicy(policyId: string) {
    return this.send("POST", `/api/operator/policy/${encodeURIComponent(policyId)}/settle`, {
      key: this.requireOperatorKey()
    });
  }

  /** Operator scope: the ledger-derived review queue (exceptions needing attention). */
  async getReviewQueue() {
    return this.send("GET", "/api/operator/review-queue", { key: this.requireOperatorKey() });
  }

  /** Operator scope: long-poll for the next pending pricing job(s). */
  async waitForPricingJob(since?: string) {
    const query = since ? `?since=${encodeURIComponent(since)}` : "";
    return this.send("GET", `/api/operator/pricing-queue/wait${query}`, { key: this.requireOperatorKey() });
  }

  /** Operator scope: submit a grounded risk memo; PIO clamps the score into the band. */
  async submitResearchQuote(quoteId: string, memo: RiskMemoInput) {
    return this.send("POST", `/api/operator/quote/${encodeURIComponent(quoteId)}/price`, {
      body: memo,
      key: this.requireOperatorKey()
    });
  }

  /** Operator scope: post a best-effort progress milestone for the live intake feed. */
  async reportProgress(quoteId: string, step: string, detail?: string) {
    return this.send("POST", `/api/operator/quote/${encodeURIComponent(quoteId)}/progress`, {
      body: detail === undefined ? { step } : { step, detail },
      key: this.requireOperatorKey()
    });
  }

  private requireAgentKey(): string {
    if (!this.agentKey) throw new Error("agentKey is required for buyer-scope calls.");
    return this.agentKey;
  }

  private requireOperatorKey(): string {
    if (!this.operatorKey) throw new Error("operatorKey is required for operator-scope calls.");
    return this.operatorKey;
  }

  private async send(
    method: "GET" | "POST",
    path: string,
    options: { body?: unknown; key?: string } = {}
  ): Promise<PioResponse> {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.key) headers.authorization = `Bearer ${options.key}`;

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });

    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ...body, status: response.status, body } as PioResponse;
  }
}
