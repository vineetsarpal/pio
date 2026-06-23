import { NextResponse } from "next/server";
import { AgentPurchaseConfirmationStore, handleDynamicPurchaseConfirmation } from "@/lib/agent-coverage";
import { getSeededAgent } from "@/lib/agent-seed";
import { getPolicyStore } from "@/lib/policy-store-factory";
import { createLiveStripeCheckoutAdapterFromEnv } from "@/lib/stripe-checkout";

/**
 * Browser-facing buy proxy for a priced dynamic quote.
 *
 * The browser sends ONLY { maximumPremium }. This route supplies agentId from
 * the server-side seeded agent identity — the agent key never travels to the
 * browser. A deterministic idempotency key per quoteId makes repeated Buy
 * clicks safe (idempotent replay).
 */
const confirmations = new AgentPurchaseConfirmationStore();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  let seed;
  try {
    seed = getSeededAgent();
  } catch (e) {
    return NextResponse.json(
      {
        accepted: false,
        reasonCode: "agent_seed_not_configured",
        message: e instanceof Error ? e.message : "Seeded agent not configured."
      },
      { status: 503 }
    );
  }

  let payments;
  try {
    payments = createLiveStripeCheckoutAdapterFromEnv();
  } catch (e) {
    return NextResponse.json(
      {
        accepted: false,
        reasonCode: "stripe_not_configured",
        message: e instanceof Error ? e.message : "Stripe not configured."
      },
      { status: 503 }
    );
  }

  const { quoteId } = await params;
  const body = (await request.json().catch(() => ({}))) as { maximumPremium?: unknown };

  const result = await handleDynamicPurchaseConfirmation(
    {
      agentId: seed.agentId,
      quoteId,
      idempotencyKey: `buy-${quoteId}`,
      authorization: "confirm_purchase",
      maximumPremium: body.maximumPremium
    },
    { store: getPolicyStore(), payments, confirmations }
  );

  return NextResponse.json(result, { status: result.accepted ? 200 : 422 });
}
