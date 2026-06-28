import { NextResponse } from "next/server";
import { getPolicyStore } from "@/lib/policy-store-factory";
import { verifyPolicyStatusToken } from "@/lib/policy-status-token";

export async function GET(request: Request, { params }: { params: Promise<{ policyId: string }> }) {
  const { policyId } = await params;
  const searchParams = new URL(request.url).searchParams;
  const token = searchParams.get("t");
  const sessionId = searchParams.get("session_id");

  const verified = verifyPolicyStatusToken(policyId, token);
  if (!verified.ok) {
    const sessionVerified = await verifyCheckoutSessionPolicy(policyId, sessionId);
    if (!sessionVerified.ok) {
      return NextResponse.json({ ok: false, reason: sessionVerified.reason }, { status: 401 });
    }
  }

  const policy = await getPolicyStore().getPolicy(policyId);
  if (!policy) {
    return NextResponse.json({ found: false }, { status: 404 });
  }

  return NextResponse.json({
    found: true,
    status: policy.status,
    activated: isActivatedStatus(policy.status),
    premium: policy.premium,
    certificateId: policy.certificateId,
    eventName: policy.eventName
  });
}

type StripeCheckoutSessionResponse = {
  id?: string;
  payment_status?: string;
  metadata?: Record<string, unknown> | null;
  error?: {
    message?: string;
  };
};

async function verifyCheckoutSessionPolicy(
  policyId: string,
  sessionId: string | null
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!sessionId) return { ok: false, reason: "missing_token" };

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return { ok: false, reason: "stripe_not_configured" };

  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${secretKey}` }
  });
  const session = (await response.json()) as StripeCheckoutSessionResponse;
  if (!response.ok) return { ok: false, reason: "checkout_session_lookup_failed" };
  if (session.payment_status !== "paid") return { ok: false, reason: "checkout_not_paid" };
  if (session.metadata?.policy_id !== policyId) return { ok: false, reason: "policy_mismatch" };

  return { ok: true };
}

function isActivatedStatus(status: string): boolean {
  return [
    "premium_paid",
    "policy_issued",
    "monitoring_active",
    "trigger_data_received",
    "claim_approved",
    "not_triggered",
    "manual_review",
    "payout_issued"
  ].includes(status);
}
