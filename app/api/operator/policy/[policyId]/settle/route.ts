import { NextResponse } from "next/server";
import { authenticateOperator } from "@/lib/operator-auth";
import { getPolicyStore } from "@/lib/policy-store-factory";
import { runOperatorSettlement } from "@/lib/operator-settlement";
import { createWeatherOracle } from "@/lib/weather-oracle";

/**
 * Operator settlement entrypoint. The operator (Gauge) triggers deterministic
 * settlement for a single issued policy: pull oracle evidence, evaluate the
 * trigger, and — on approval — request the payout. The actual payout completion
 * still arrives via the verified Stripe `payout.paid` webhook.
 */
export async function POST(request: Request, { params }: { params: Promise<{ policyId: string }> }) {
  let authorized: boolean;
  try {
    authorized = authenticateOperator(request);
  } catch (error) {
    return NextResponse.json(
      {
        accepted: false,
        reasonCode: "operator_not_configured",
        message: error instanceof Error ? error.message : "Operator key is not configured."
      },
      { status: 503 }
    );
  }
  if (!authorized) {
    return NextResponse.json(
      { accepted: false, reasonCode: "unauthorized", message: "A valid operator key is required." },
      { status: 401 }
    );
  }

  const { policyId } = await params;
  const result = await runOperatorSettlement(
    { policyId, now: new Date().toISOString() },
    { store: getPolicyStore(), oracle: createWeatherOracle("demo_replay") }
  );

  if (!result.accepted) {
    return NextResponse.json(result, { status: result.reasonCode === "policy_not_found" ? 404 : 409 });
  }
  return NextResponse.json(result, { status: 200 });
}
