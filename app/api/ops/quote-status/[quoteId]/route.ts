import { NextResponse } from "next/server";
import { getPolicyStore } from "@/lib/policy-store-factory";
import { quoteStatusView } from "@/lib/ops-feed";

export async function GET(_request: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  const { quoteId } = await params;
  const view = quoteStatusView(await getPolicyStore().getPricingJob(quoteId));
  return NextResponse.json({ accepted: true, ...view }, { status: view.found ? 200 : 404 });
}
