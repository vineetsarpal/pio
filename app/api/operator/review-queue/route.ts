import { NextResponse } from "next/server";
import { getPolicyStore } from "@/lib/policy-store-factory";

export async function GET() {
  const reviews = await getPolicyStore().getOperatorReviewQueue();
  return NextResponse.json({
    reviews,
    source: "ledger_derived"
  });
}
