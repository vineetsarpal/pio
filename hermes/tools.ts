/**
 * pioTools — OpenAI/Nemotron-style tool definitions the VPS Hermes agent hands
 * to its model, plus `dispatchPioToolCall`, which routes a model-emitted tool
 * call to the matching {@link PioClient} method.
 *
 * Wiring on the agent host:
 *
 *   const client = new PioClient({
 *     baseUrl: process.env.PIO_BASE_URL!,        // https://pio-platform.vercel.app
 *     agentKey: process.env.PIO_AGENT_SEED_KEY,  // buyer scope
 *     operatorKey: process.env.PIO_OPERATOR_KEY  // operator scope
 *   });
 *
 *   // pass `pioTools` as the model's tools; on each tool_call:
 *   const result = await dispatchPioToolCall(client, call.name, JSON.parse(call.arguments));
 *
 * Buyer tools (request_coverage, confirm_purchase, purchase_off_session,
 * get_policy) let any agent buy coverage within a budget cap. Operator tools
 * (settle_policy, get_review_queue) let the trusted operator run the book.
 */

import type { PioClient } from "./pio-client.js";

export type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
};

export type ToolScope = "buyer" | "operator";

export type PioTool = {
  type: "function";
  scope: ToolScope;
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
};

const money: JsonSchema = {
  type: "object",
  properties: {
    amount: { type: "number" },
    currency: { type: "string", enum: ["USD"] }
  },
  required: ["amount", "currency"]
};

const coverageRequest: JsonSchema = {
  type: "object",
  properties: {
    customerName: { type: "string" },
    eventName: { type: "string" },
    locationName: { type: "string" },
    latitude: { type: "number" },
    longitude: { type: "number" },
    eventStart: { type: "string", description: "ISO 8601 start of the covered window." },
    eventEnd: { type: "string", description: "ISO 8601 end of the covered window." },
    desiredPayout: money
  },
  required: [
    "customerName",
    "eventName",
    "locationName",
    "latitude",
    "longitude",
    "eventStart",
    "eventEnd",
    "desiredPayout"
  ]
};

export const pioTools: PioTool[] = [
  {
    type: "function",
    scope: "buyer",
    function: {
      name: "request_coverage",
      description:
        "Get a deterministic, not-yet-bound quote for parametric coverage. Use purchaseIntent 'buy_if_within_budget' with a maximumPremium to let PIO flag whether the quote fits the budget.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          ...coverageRequest.properties,
          maximumPremium: money,
          purchaseIntent: { type: "string", enum: ["quote_only", "buy_if_within_budget"] }
        },
        required: ["agentId", ...(coverageRequest.required ?? []), "purchaseIntent"]
      }
    }
  },
  {
    type: "function",
    scope: "buyer",
    function: {
      name: "confirm_purchase",
      description:
        "Confirm a received quote and create a real Stripe Checkout Session for the premium. Requires the buyer agent key. Idempotent on idempotencyKey.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string" },
          quoteId: { type: "string" },
          idempotencyKey: { type: "string" },
          authorization: { type: "string", enum: ["confirm_purchase"] },
          coverageRequest,
          maximumPremium: money
        },
        required: ["agentId", "quoteId", "idempotencyKey", "authorization", "coverageRequest", "maximumPremium"]
      }
    }
  },
  {
    type: "function",
    scope: "buyer",
    function: {
      name: "purchase_off_session",
      description:
        "Headless purchase: quote and charge the agent's vaulted card off-session in one step. Activation still depends on the verified payment webhook. Requires the buyer agent key.",
      parameters: {
        type: "object",
        properties: {
          idempotencyKey: { type: "string" },
          coverageRequest
        },
        required: ["idempotencyKey", "coverageRequest"]
      }
    }
  },
  {
    type: "function",
    scope: "buyer",
    function: {
      name: "get_policy",
      description: "Read a single policy's current status and payment/workflow ledger. Requires the buyer agent key.",
      parameters: {
        type: "object",
        properties: { policyId: { type: "string" } },
        required: ["policyId"]
      }
    }
  },
  {
    type: "function",
    scope: "operator",
    function: {
      name: "settle_policy",
      description:
        "Operator action: pull oracle evidence, evaluate the trigger deterministically, and on approval request the payout. Never decides the payout itself. Requires the operator key.",
      parameters: {
        type: "object",
        properties: { policyId: { type: "string" } },
        required: ["policyId"]
      }
    }
  },
  {
    type: "function",
    scope: "operator",
    function: {
      name: "get_review_queue",
      description: "Operator action: list ledger-derived exceptions needing attention (e.g. failed payouts). Requires the operator key.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function", scope: "operator",
    function: {
      name: "wait_for_pricing_job",
      description: "Long-poll for the next pending dynamic-pricing job(s). Returns immediately if one is waiting, else after ~25s. Pass the createdAt of the last job you handled as `since` to avoid re-seeing it.",
      parameters: { type: "object", properties: { since: { type: "string", description: "ISO 8601 cursor; return jobs newer than this." } } }
    }
  },
  {
    type: "function", scope: "operator",
    function: {
      name: "submit_research_quote",
      description: "Submit a grounded risk memo for a pending quote. PIO maps riskScore (0..1) into the typed premium band and clamps it; empty evidence fails closed to PIO's deterministic adapter. Cite every claim.",
      parameters: {
        type: "object",
        properties: {
          quoteId: { type: "string" },
          riskScore: { type: "number", description: "0..1; higher = more likely the trigger fires." },
          evidence: {
            type: "array",
            items: { type: "object", properties: {
              url: { type: "string" }, title: { type: "string" }, snippet: { type: "string" }, retrievedAt: { type: "string" }
            }, required: ["url", "title", "snippet", "retrievedAt"] }
          },
          factors: { type: "array", items: { type: "string" } },
          toolName: { type: "string" },
          model: { type: "string" }
        },
        required: ["quoteId", "riskScore", "evidence", "toolName"]
      }
    }
  },
  {
    type: "function", scope: "buyer",
    function: {
      name: "request_dynamic_coverage",
      description: "Request a quote that an operator prices from live web research. Returns a quoteId immediately with no premium; poll get_policy until status is policy_quoted.",
      parameters: {
        type: "object",
        properties: {
          productId: { type: "string", enum: ["rain_event", "flight_delay"] },
          customerName: { type: "string" }, eventName: { type: "string" }, locationName: { type: "string" },
          latitude: { type: "number" }, longitude: { type: "number" },
          eventStart: { type: "string" }, eventEnd: { type: "string" },
          passengerName: { type: "string" }, airline: { type: "string" }, flightNumber: { type: "string" },
          originAirport: { type: "string" }, destinationAirport: { type: "string" },
          departureTime: { type: "string" }, arrivalTime: { type: "string" },
          desiredPayout: money, deductible: money, maximumPremium: money
        },
        required: ["productId", "customerName", "desiredPayout"]
      }
    }
  },
  {
    type: "function", scope: "buyer",
    function: {
      name: "confirm_dynamic_purchase",
      description: "Buy a priced dynamic quote by replaying its stored premium. Requires the buyer agent key. Idempotent on idempotencyKey.",
      parameters: {
        type: "object",
        properties: {
          agentId: { type: "string" }, quoteId: { type: "string" }, idempotencyKey: { type: "string" },
          authorization: { type: "string", enum: ["confirm_purchase"] }, maximumPremium: money
        },
        required: ["agentId", "quoteId", "idempotencyKey", "authorization", "maximumPremium"]
      }
    }
  }
];

/**
 * Route a model-emitted tool call to the matching client method. `args` is the
 * already-parsed JSON arguments object from the tool call.
 */
export function dispatchPioToolCall(
  client: PioClient,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "request_coverage":
      return client.requestCoverage(args as Parameters<PioClient["requestCoverage"]>[0]);
    case "confirm_purchase":
      return client.confirmPurchase(args as Parameters<PioClient["confirmPurchase"]>[0]);
    case "purchase_off_session":
      return client.purchaseOffSession(args as Parameters<PioClient["purchaseOffSession"]>[0]);
    case "get_policy":
      return client.getPolicy(String(args.policyId));
    case "settle_policy":
      return client.settlePolicy(String(args.policyId));
    case "get_review_queue":
      return client.getReviewQueue();
    case "wait_for_pricing_job":
      return client.waitForPricingJob(args.since === undefined ? undefined : String(args.since));
    case "submit_research_quote":
      return client.submitResearchQuote(String(args.quoteId), args as Parameters<PioClient["submitResearchQuote"]>[1]);
    case "request_dynamic_coverage":
      return client.requestDynamicCoverage(args as Parameters<PioClient["requestDynamicCoverage"]>[0]);
    case "confirm_dynamic_purchase":
      return client.confirmDynamicPurchase(args as Parameters<PioClient["confirmDynamicPurchase"]>[0]);
    default:
      return Promise.reject(new Error(`Unknown PIO tool: ${name}`));
  }
}
