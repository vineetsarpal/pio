import { NextResponse } from "next/server";
import { getPolicyStore } from "@/lib/policy-store-factory";
import { operatorOk, unauthorized } from "@/lib/operator-http";

export async function GET(request: Request) {
  if (!operatorOk(request)) return unauthorized();
  const since = new URL(request.url).searchParams.get("since") ?? undefined;
  const jobs = await getPolicyStore().listPendingPricingJobs(since);
  return NextResponse.json({ accepted: true, jobs });
}
