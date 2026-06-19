import type { AgentChargeScope } from "./agent-purchase";

/**
 * The single seeded agent identity for the tracer-bullet slice. Deliberately
 * thin: one hardcoded-via-env API key mapped to one seeded Stripe customer and
 * one vaulted test card. Real per-agent identity, hashed keys, and scoping
 * arrive in a later slice (#7); this exists only to prove the headless path.
 */
export type SeededAgent = AgentChargeScope & { key: string };

export function getSeededAgent(): SeededAgent {
  const key = process.env.PIO_AGENT_SEED_KEY ?? "";
  const customerId = process.env.PIO_SEED_STRIPE_CUSTOMER ?? "";
  const paymentMethodId = process.env.PIO_SEED_STRIPE_PAYMENT_METHOD ?? "";
  if (!key || !customerId || !paymentMethodId) {
    throw new Error(
      "PIO_AGENT_SEED_KEY, PIO_SEED_STRIPE_CUSTOMER, and PIO_SEED_STRIPE_PAYMENT_METHOD must be set for the headless purchase path."
    );
  }
  return {
    agentId: process.env.PIO_AGENT_SEED_ID ?? "agent_seed_demo",
    key,
    customerId,
    paymentMethodId
  };
}

/**
 * Authenticate a request against the seeded agent key, accepting either an
 * `Authorization: Bearer <key>` header or `x-pio-agent-key`. Returns the agent
 * scope on success, or `undefined` for a missing/invalid key (→ 401).
 */
export function authenticateSeededAgent(request: Request): SeededAgent | undefined {
  const seed = getSeededAgent();
  const header = request.headers.get("authorization");
  const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined;
  const presented = bearer ?? request.headers.get("x-pio-agent-key") ?? undefined;
  if (!presented || presented !== seed.key) return undefined;
  return seed;
}
