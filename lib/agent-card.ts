/**
 * The A2A-style Agent Card PIO publishes at `/.well-known/agent-card.json`.
 *
 * This is a *discovery* manifest: it lets any agent find PIO's buyer API and
 * learn how to authenticate, without out-of-band docs. It is schema-shaped to
 * A2A v0.3.0 (so it reads as a recognized Agent Card) but PIO is not an A2A
 * JSON-RPC server — it is a REST buyer API plus an MCP server. So each buyer
 * capability is expressed as a `skill` whose `examples` carry the real REST
 * call, `preferredTransport` is `HTTP+JSON`, and `url` points at the REST agent
 * base. The card describes what already exists; it does not imply per-agent
 * identity or funding (that is a later slice — today a buyer uses the seeded key).
 */

export type AgentCardSkill = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples: string[];
};

export type AgentCard = {
  protocolVersion: string;
  name: string;
  description: string;
  version: string;
  provider: { organization: string; url: string };
  url: string;
  preferredTransport: string;
  additionalInterfaces: Array<{ url: string; transport: string }>;
  capabilities: { streaming: boolean; pushNotifications: boolean; stateTransitionHistory: boolean };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  securitySchemes: Record<string, { type: string; in: string; name: string; description: string }>;
  security: Array<Record<string, string[]>>;
  documentationUrl: string;
  skills: AgentCardSkill[];
};

/** Build the Agent Card for a given deployment base URL (no trailing slash). */
export function buildAgentCard(baseUrl: string): AgentCard {
  const base = baseUrl.replace(/\/$/, "");
  const agentApi = `${base}/api/agent`;

  return {
    protocolVersion: "0.3.0",
    name: "PIO",
    description:
      "PIO issues parametric weather and flight-delay coverage whose payout is decided " +
      "deterministically from an external data feed. Agents can request a quote and bind a " +
      "Policy through the REST buyer API below. An MCP server (Hermes) exposes the same buyer " +
      "tools for MCP-native agents.",
    version: "0.1.0",
    provider: { organization: "PIO", url: base },
    url: agentApi,
    preferredTransport: "HTTP+JSON",
    additionalInterfaces: [{ url: agentApi, transport: "HTTP+JSON" }],
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    securitySchemes: {
      agentKey: {
        type: "apiKey",
        in: "header",
        name: "x-pio-agent-key",
        description:
          "Buyer agent API key. Also accepted as `Authorization: Bearer <key>`. Required on every " +
          "purchase and policy-read call."
      }
    },
    security: [{ agentKey: [] }],
    documentationUrl: base,
    skills: [
      {
        id: "request_dynamic_coverage",
        name: "Request dynamic coverage",
        description:
          "Request a quote priced from live operator research. Returns a quoteId immediately with " +
          "no premium yet; poll get_policy until status is policy_quoted.",
        tags: ["quote", "coverage", "parametric"],
        examples: [
          `POST ${agentApi}/coverage-request ` +
            `{"pricing":"dynamic","productId":"rain_event","customerName":"Acme","desiredPayout":{"amount":500,"currency":"USD"}}`
        ]
      },
      {
        id: "confirm_dynamic_purchase",
        name: "Confirm dynamic purchase",
        description:
          "Bind a priced dynamic quote by replaying its stored premium, capped by maximumPremium. " +
          "Returns a Stripe test-mode checkout URL. Idempotent on idempotencyKey.",
        tags: ["purchase", "checkout", "bind"],
        examples: [
          `POST ${agentApi}/confirm-dynamic-purchase ` +
            `{"agentId":"...","quoteId":"...","idempotencyKey":"...","authorization":"confirm_purchase","maximumPremium":{"amount":120,"currency":"USD"}}`
        ]
      },
      {
        id: "purchase_off_session",
        name: "Purchase off-session",
        description:
          "Headless purchase: quote and charge the agent's vaulted card off-session in one call. " +
          "Activation to policy_issued depends on the verified payment webhook. Idempotent on idempotencyKey.",
        tags: ["purchase", "headless", "off-session"],
        examples: [
          `POST ${agentApi}/purchase ` +
            `{"idempotencyKey":"...","coverageRequest":{"customerName":"Acme","eventName":"...","locationName":"...","latitude":0,"longitude":0,"eventStart":"...","eventEnd":"...","desiredPayout":{"amount":500,"currency":"USD"}}}`
        ]
      },
      {
        id: "get_policy",
        name: "Get policy status",
        description:
          "Read a single policy's current status plus its payment and workflow ledger. Used to poll a " +
          "pending quote to policy_quoted and to confirm policy_issued after purchase.",
        tags: ["read", "status", "poll"],
        examples: [`GET ${agentApi}/policy/{policyId}`]
      }
    ]
  };
}
