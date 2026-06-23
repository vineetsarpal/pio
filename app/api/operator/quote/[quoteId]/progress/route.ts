import { NextResponse } from "next/server";
import { authenticateOperator } from "@/lib/operator-auth";
import { getPolicyStore } from "@/lib/policy-store-factory";
import { parseJsonBody, progressEventSchema } from "@/lib/http-schemas";
import { appendJobProgress } from "@/lib/operator-research-pricing";

export async function POST(request: Request, { params }: { params: Promise<{ quoteId: string }> }) {
  let authorized: boolean;
  try { authorized = authenticateOperator(request); }
  catch (e) { return NextResponse.json({ accepted: false, reasonCode: "operator_not_configured", message: e instanceof Error ? e.message : "Operator key not configured." }, { status: 503 }); }
  if (!authorized) return NextResponse.json({ accepted: false, reasonCode: "unauthorized", message: "A valid operator key is required." }, { status: 401 });

  const parsed = await parseJsonBody(request, progressEventSchema);
  if (!parsed.ok) return NextResponse.json({ accepted: false, reasonCode: "invalid_request", message: parsed.message }, { status: 400 });

  const { quoteId } = await params;
  const result = await appendJobProgress({ quoteId, step: parsed.data.step, detail: parsed.data.detail, now: new Date().toISOString() }, { store: getPolicyStore() });
  if (!result.accepted) return NextResponse.json(result, { status: result.reasonCode === "job_not_found" ? 404 : 409 });
  return NextResponse.json(result, { status: 200 });
}
