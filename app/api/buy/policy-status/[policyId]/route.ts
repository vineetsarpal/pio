import { NextResponse } from "next/server";
import { getPolicyStore } from "@/lib/policy-store-factory";
import { verifyPolicyStatusToken } from "@/lib/policy-status-token";

export async function GET(request: Request, { params }: { params: Promise<{ policyId: string }> }) {
  const { policyId } = await params;
  const token = new URL(request.url).searchParams.get("t");

  const verified = verifyPolicyStatusToken(policyId, token);
  if (!verified.ok) {
    return NextResponse.json({ ok: false, reason: verified.reason }, { status: 401 });
  }

  const policy = await getPolicyStore().getPolicy(policyId);
  if (!policy) {
    return NextResponse.json({ found: false }, { status: 404 });
  }

  return NextResponse.json({
    found: true,
    status: policy.status,
    activated: policy.status === "premium_paid",
    premium: policy.premium,
    certificateId: policy.certificateId,
    eventName: policy.eventName
  });
}
