import { NextResponse } from "next/server";
import { authenticateOperator } from "@/lib/operator-auth";
import { getPolicyStore } from "@/lib/policy-store-factory";

export async function GET(request: Request) {
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

  const reviews = await getPolicyStore().getOperatorReviewQueue();
  return NextResponse.json({
    reviews,
    source: "ledger_derived"
  });
}
