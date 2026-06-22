import { NextResponse } from "next/server";
import { AgentPurchaseConfirmationStore, handleDynamicPurchaseConfirmation } from "@/lib/agent-coverage";
import { authenticateSeededAgent } from "@/lib/agent-seed";
import { createLiveStripeCheckoutAdapterFromEnv } from "@/lib/stripe-checkout";
import { getPolicyStore } from "@/lib/policy-store-factory";
import { confirmDynamicPurchaseSchema, parseJsonBody } from "@/lib/http-schemas";

const confirmations = new AgentPurchaseConfirmationStore();

/**
 * Purchase confirmation for a priced dynamic quote. The premium is REPLAYED
 * from the stored policy (set by the operator in Task 8) — no re-quote, no
 * re-research. The buyer presents their agent key, the quoteId they received
 * from the dynamic pricing flow, a maximumPremium cap, and an idempotency key.
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

  const parsed = await parseJsonBody(request, confirmDynamicPurchaseSchema);
  if (!parsed.ok) {
    return NextResponse.json(
      { accepted: false, reasonCode: "invalid_request", message: parsed.message },
      { status: 400 }
    );
  }

  const result = await handleDynamicPurchaseConfirmation(parsed.data, { store: getPolicyStore(), payments, confirmations });
  return NextResponse.json(result, { status: result.accepted ? 200 : 422 });
}
