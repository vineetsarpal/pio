import { NextResponse } from "next/server";
import { authenticateSeededAgent } from "@/lib/agent-seed";
import { getPolicyStore } from "@/lib/policy-store-factory";

/** Read a single policy's status and payment ledger — lets the headless driver confirm policy_issued. */
export async function GET(request: Request, { params }: { params: Promise<{ policyId: string }> }) {
  let seed;
  try {
    seed = authenticateSeededAgent(request);
  } catch (error) {
    return NextResponse.json(
      {
        accepted: false,
        reasonCode: "agent_seed_not_configured",
        message: error instanceof Error ? error.message : "Seeded agent is not configured."
      },
      { status: 503 }
    );
  }
  if (!seed) {
    return NextResponse.json(
      { accepted: false, reasonCode: "unauthorized", message: "A valid agent API key is required." },
      { status: 401 }
    );
  }

  const { policyId } = await params;
  const snapshot = await getPolicyStore().snapshotForPolicy(policyId);
  const policy = snapshot.policies[0];
  if (!policy) {
    return NextResponse.json(
      { accepted: false, reasonCode: "policy_not_found", message: `Policy ${policyId} was not found.` },
      { status: 404 }
    );
  }

  return NextResponse.json({
    accepted: true,
    policy,
    status: policy.status,
    paymentEvents: snapshot.paymentEvents,
    workflowEvents: snapshot.workflowEvents
  });
}
