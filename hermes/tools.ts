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

export type PioTool = {
  type: "function";
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
    function: {
      name: "get_review_queue",
      description: "Operator action: list ledger-derived exceptions needing attention (e.g. failed payouts). Requires the operator key.",
      parameters: { type: "object", properties: {} }
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
    default:
      return Promise.reject(new Error(`Unknown PIO tool: ${name}`));
  }
}
