import { NextResponse } from "next/server";
import { authenticateSeededAgent } from "@/lib/agent-seed";
import { handleAgentOffSessionPurchase } from "@/lib/agent-purchase";
import { getPolicyStore } from "@/lib/policy-store-factory";
import { createLiveStripePaymentIntentAdapterFromEnv } from "@/lib/stripe-payment-intent";
import type { CoverageRequest } from "@/lib/types";

/**
 * Headless off-session purchase entrypoint. An authorized agent presents its
 * seeded key, a coverage request, and an idempotency key; we quote, persist, and
 * charge the agent's vaulted card off-session. Activation to policy_issued
 * happens via the payment_intent webhook.
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

  const body = (await request.json()) as {
    idempotencyKey?: unknown;
    coverageRequest?: CoverageRequest;
  };
  if (typeof body.idempotencyKey !== "string" || !body.idempotencyKey) {
    return NextResponse.json(
      { accepted: false, reasonCode: "invalid_request", message: "idempotencyKey is required." },
      { status: 400 }
    );
  }
  if (!body.coverageRequest || typeof body.coverageRequest !== "object") {
    return NextResponse.json(
      { accepted: false, reasonCode: "invalid_request", message: "coverageRequest is required." },
      { status: 400 }
    );
  }

  let payments;
  try {
    payments = createLiveStripePaymentIntentAdapterFromEnv();
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

  const result = await handleAgentOffSessionPurchase(
    { idempotencyKey: body.idempotencyKey, coverageRequest: body.coverageRequest },
    { store: getPolicyStore(), payments, seed }
  );

  return NextResponse.json(result, { status: result.accepted ? 200 : 402 });
}
