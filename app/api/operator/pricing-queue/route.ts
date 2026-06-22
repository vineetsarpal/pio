import { NextResponse } from "next/server";
import { authenticateOperator } from "@/lib/operator-auth";
import { getPolicyStore } from "@/lib/policy-store-factory";

export async function GET(request: Request) {
  if (!operatorOk(request)) return unauthorized();
  const since = new URL(request.url).searchParams.get("since") ?? undefined;
  const jobs = await getPolicyStore().listPendingPricingJobs(since);
  return NextResponse.json({ accepted: true, jobs });
}

export function operatorOk(request: Request): boolean {
  try {
    return authenticateOperator(request);
  } catch {
    return false;
  }
}

export function unauthorized() {
  return NextResponse.json(
    { accepted: false, reasonCode: "unauthorized", message: "A valid operator key is required." },
    { status: 401 }
  );
}
