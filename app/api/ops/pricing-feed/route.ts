import { NextResponse } from "next/server";
import { getPolicyStore } from "@/lib/policy-store-factory";
import { pricingFeedView } from "@/lib/ops-feed";

export async function GET() {
  const view = pricingFeedView(await getPolicyStore().listPricingJobs());
  return NextResponse.json({ accepted: true, ...view });
}
