import type {
  AgentCoverageRequest,
  AgentCoverageResponse,
  AgentPurchaseConfirmationRequest,
  AgentPurchaseConfirmationResponse,
  Money
} from "./types";
import type { PaymentAdapter } from "./payment-adapter";
import { SimulatedHermesStripeSkillsAdapter } from "./payment-adapter";
import { quotePolicy } from "./workflow";

type IdempotencyRecord = {
  fingerprint: string;
  response: Extract<AgentPurchaseConfirmationResponse, { accepted: true }>;
};

export class AgentPurchaseConfirmationStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  get(idempotencyKey: string): IdempotencyRecord | undefined {
    return this.records.get(idempotencyKey);
  }

  set(idempotencyKey: string, record: IdempotencyRecord): void {
    this.records.set(idempotencyKey, record);
  }
}

export function handleAgentCoverageRequest(input: unknown): AgentCoverageResponse {
  const parsed = parseAgentCoverageRequest(input);
  if (!parsed.ok) {
    return {
      accepted: false,
      reasonCode: "invalid_request",
      message: parsed.error
    };
  }

  const request = parsed.request;
  if (
    request.desiredPayout.currency !== "USD" ||
    (request.maximumPremium && request.maximumPremium.currency !== "USD")
  ) {
    return {
      accepted: false,
      reasonCode: "unsupported_currency",
      agentId: request.agentId,
      message: "PIO demo coverage only supports USD-denominated premium and payout constraints."
    };
  }

  if (request.purchaseIntent !== "quote_only" && request.purchaseIntent !== "buy_if_within_budget") {
    return {
      accepted: false,
      reasonCode: "unsupported_purchase_intent",
      agentId: request.agentId,
      message: "purchaseIntent must be quote_only or buy_if_within_budget."
    };
  }

  const quoteRequest = {
    customerName: request.customerName,
    eventName: request.eventName,
    locationName: request.locationName,
    latitude: request.latitude,
    longitude: request.longitude,
    eventStart: request.eventStart,
    eventEnd: request.eventEnd,
    desiredPayout: request.desiredPayout
  };
  const policy = quotePolicy(quoteRequest);

  if (request.maximumPremium && policy.premium.amount > request.maximumPremium.amount) {
    return {
      accepted: false,
      reasonCode: "premium_cap_exceeded",
      agentId: request.agentId,
      message: `Quoted premium ${formatMoney(policy.premium)} exceeds maximum premium ${formatMoney(request.maximumPremium)}.`,
      constraints: {
        maximumPremium: request.maximumPremium,
        quotedPremium: policy.premium
      }
    };
  }

  return {
    accepted: true,
    reasonCode: "quote_ready",
    agentId: request.agentId,
    policy,
    nextAction: request.purchaseIntent === "buy_if_within_budget" ? "create_checkout" : "present_quote",
    constraints: {
      maximumPremium: request.maximumPremium,
      premiumWithinBudget: true
    }
  };
}

export async function handleAgentPurchaseConfirmation(
  input: unknown,
  {
    payments = new SimulatedHermesStripeSkillsAdapter(),
    confirmations = new AgentPurchaseConfirmationStore()
  }: {
    payments?: Pick<PaymentAdapter, "mode" | "createCustomer" | "createCheckout">;
    confirmations?: AgentPurchaseConfirmationStore;
  } = {}
): Promise<AgentPurchaseConfirmationResponse> {
  const parsed = parseAgentPurchaseConfirmationRequest(input);
  if (!parsed.ok) {
    return {
      accepted: false,
      reasonCode: "invalid_request",
      message: parsed.error
    };
  }

  const request = parsed.request;
  if (request.authorization !== "confirm_purchase") {
    return {
      accepted: false,
      reasonCode: "authorization_required",
      agentId: request.agentId,
      quoteId: request.quoteId,
      idempotencyKey: request.idempotencyKey,
      message: "Agent purchase confirmation requires authorization: confirm_purchase."
    };
  }

  const quotedPolicy = quotePolicy(request.coverageRequest);
  if (quotedPolicy.id !== request.quoteId) {
    return {
      accepted: false,
      reasonCode: "quote_mismatch",
      agentId: request.agentId,
      quoteId: request.quoteId,
      idempotencyKey: request.idempotencyKey,
      message: "quoteId does not match the deterministic quote for the supplied coverage request."
    };
  }

  if (quotedPolicy.premium.amount > request.maximumPremium.amount) {
    return {
      accepted: false,
      reasonCode: "premium_cap_exceeded",
      agentId: request.agentId,
      quoteId: request.quoteId,
      idempotencyKey: request.idempotencyKey,
      message: `Quoted premium ${formatMoney(quotedPolicy.premium)} exceeds maximum premium ${formatMoney(request.maximumPremium)}.`,
      constraints: {
        maximumPremium: request.maximumPremium,
        quotedPremium: quotedPolicy.premium
      }
    };
  }

  const fingerprint = stableStringify({
    agentId: request.agentId,
    quoteId: request.quoteId,
    authorization: request.authorization,
    coverageRequest: request.coverageRequest,
    maximumPremium: request.maximumPremium
  });
  const existing = confirmations.get(request.idempotencyKey);
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      return {
        accepted: false,
        reasonCode: "idempotency_conflict",
        agentId: request.agentId,
        quoteId: request.quoteId,
        idempotencyKey: request.idempotencyKey,
        message: "Idempotency key was already used with different purchase confirmation details."
      };
    }

    return {
      ...existing.response,
      idempotentReplay: true
    };
  }

  const customer = await payments.createCustomer(request.coverageRequest.customerName);
  const checkout = await payments.createCheckout(quotedPolicy, customer);
  const response: Extract<AgentPurchaseConfirmationResponse, { accepted: true }> = {
    accepted: true,
    reasonCode: "checkout_created",
    agentId: request.agentId,
    quoteId: request.quoteId,
    idempotencyKey: request.idempotencyKey,
    idempotentReplay: false,
    policy: quotedPolicy,
    checkout,
    nextAction: "complete_stripe_checkout"
  };
  confirmations.set(request.idempotencyKey, { fingerprint, response });

  return response;
}

function parseAgentCoverageRequest(input: unknown):
  | { ok: true; request: AgentCoverageRequest }
  | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "Request body must be a JSON object." };

  const requiredStrings = [
    "agentId",
    "customerName",
    "eventName",
    "locationName",
    "eventStart",
    "eventEnd",
    "purchaseIntent"
  ] as const;
  for (const field of requiredStrings) {
    if (typeof input[field] !== "string" || input[field].length === 0) {
      return { ok: false, error: `${field} is required.` };
    }
  }

  if (typeof input.latitude !== "number" || typeof input.longitude !== "number") {
    return { ok: false, error: "latitude and longitude must be numbers." };
  }

  const desiredPayout = parseMoney(input.desiredPayout);
  if (!desiredPayout) return { ok: false, error: "desiredPayout must include amount and currency." };

  const maximumPremium = input.maximumPremium === undefined ? undefined : parseMoney(input.maximumPremium);
  if (input.maximumPremium !== undefined && !maximumPremium) {
    return { ok: false, error: "maximumPremium must include amount and currency when provided." };
  }

  return {
    ok: true,
    request: {
      agentId: input.agentId as string,
      customerName: input.customerName as string,
      eventName: input.eventName as string,
      locationName: input.locationName as string,
      latitude: input.latitude as number,
      longitude: input.longitude as number,
      eventStart: input.eventStart as string,
      eventEnd: input.eventEnd as string,
      desiredPayout,
      maximumPremium,
      purchaseIntent: input.purchaseIntent as AgentCoverageRequest["purchaseIntent"]
    }
  };
}

function parseAgentPurchaseConfirmationRequest(input: unknown):
  | { ok: true; request: AgentPurchaseConfirmationRequest }
  | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: "Request body must be a JSON object." };

  const requiredStrings = ["agentId", "quoteId", "idempotencyKey", "authorization"] as const;
  for (const field of requiredStrings) {
    if (typeof input[field] !== "string" || input[field].length === 0) {
      return { ok: false, error: `${field} is required.` };
    }
  }

  if (!isRecord(input.coverageRequest)) {
    return { ok: false, error: "coverageRequest is required." };
  }

  const coverageRequest = parseCoverageRequest(input.coverageRequest);
  if (!coverageRequest.ok) return coverageRequest;

  const maximumPremium = parseMoney(input.maximumPremium);
  if (!maximumPremium) return { ok: false, error: "maximumPremium must include amount and currency." };
  if (maximumPremium.currency !== "USD") return { ok: false, error: "maximumPremium must be denominated in USD." };

  return {
    ok: true,
    request: {
      agentId: input.agentId as string,
      quoteId: input.quoteId as string,
      idempotencyKey: input.idempotencyKey as string,
      authorization: input.authorization as AgentPurchaseConfirmationRequest["authorization"],
      coverageRequest: coverageRequest.request,
      maximumPremium
    }
  };
}

function parseCoverageRequest(input: Record<string, unknown>):
  | { ok: true; request: AgentPurchaseConfirmationRequest["coverageRequest"] }
  | { ok: false; error: string } {
  const requiredStrings = ["customerName", "eventName", "locationName", "eventStart", "eventEnd"] as const;
  for (const field of requiredStrings) {
    if (typeof input[field] !== "string" || input[field].length === 0) {
      return { ok: false, error: `coverageRequest.${field} is required.` };
    }
  }

  if (typeof input.latitude !== "number" || typeof input.longitude !== "number") {
    return { ok: false, error: "coverageRequest.latitude and coverageRequest.longitude must be numbers." };
  }

  const desiredPayout = parseMoney(input.desiredPayout);
  if (!desiredPayout) return { ok: false, error: "coverageRequest.desiredPayout must include amount and currency." };
  if (desiredPayout.currency !== "USD") {
    return { ok: false, error: "coverageRequest.desiredPayout must be denominated in USD." };
  }

  return {
    ok: true,
    request: {
      customerName: input.customerName as string,
      eventName: input.eventName as string,
      locationName: input.locationName as string,
      latitude: input.latitude as number,
      longitude: input.longitude as number,
      eventStart: input.eventStart as string,
      eventEnd: input.eventEnd as string,
      desiredPayout
    }
  };
}

function parseMoney(value: unknown): Money | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.amount !== "number" || value.amount < 0) return undefined;
  if (value.currency !== "USD") {
    return {
      amount: value.amount,
      currency: value.currency as "USD"
    };
  }
  return {
    amount: value.amount,
    currency: "USD"
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatMoney(money: Money): string {
  return `$${money.amount} ${money.currency}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
