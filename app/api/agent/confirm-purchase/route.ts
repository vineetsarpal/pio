import { NextResponse } from "next/server";
import { AgentPurchaseConfirmationStore, handleAgentPurchaseConfirmation } from "@/lib/agent-coverage";
import { authenticateSeededAgent } from "@/lib/agent-seed";
import { createLiveStripeCheckoutAdapterFromEnv } from "@/lib/stripe-checkout";

const confirmations = new AgentPurchaseConfirmationStore();

/**
 * Hosted-checkout purchase entrypoint for any authenticated agent. The agent
 * presents its key, a quote it already received, and an idempotency key; we
 * re-derive the deterministic quote, enforce the premium cap, and create a real
 * Stripe test-mode Checkout Session. Activation to policy_issued still depends on
 * the verified checkout webhook, never on the success redirect.
 */
export async function POST(request: Request) {
  let seed;
  try {
    seed = authenticateSeededAgent(request);
  } catch (error) {
    return NextResponse.json(
      {
        accepted: false,
        reasonCode: "agent_seed_not_configured",
        message: error instanceof Error ? error.message : "Seeded agent is not configured."
      },
      { status: 503 }
    );
  }
  if (!seed) {
    return NextResponse.json(
      { accepted: false, reasonCode: "unauthorized", message: "A valid agent API key is required." },
      { status: 401 }
    );
  }

  let payments;
  try {
    payments = createLiveStripeCheckoutAdapterFromEnv();
  } catch (error) {
    return NextResponse.json(
      {
        accepted: false,
        reasonCode: "stripe_not_configured",
        message: error instanceof Error ? error.message : "Stripe is not configured."
      },
      { status: 503 }
    );
  }

  const result = await handleAgentPurchaseConfirmation(await request.json(), { payments, confirmations });
  return NextResponse.json(result, { status: result.accepted ? 200 : 422 });
}
