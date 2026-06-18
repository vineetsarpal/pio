import { NextResponse } from "next/server";
import { demoRun } from "@/lib/demo-data";

export async function GET() {
  return NextResponse.json({
    reviews: demoRun.operatorReviewQueue,
    source: "ledger_derived"
  });
}
