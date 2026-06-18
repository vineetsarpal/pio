import { NextResponse } from "next/server";
import { AgentPurchaseConfirmationStore, handleAgentPurchaseConfirmation } from "@/lib/agent-coverage";

const confirmations = new AgentPurchaseConfirmationStore();

export async function POST(request: Request) {
  const result = await handleAgentPurchaseConfirmation(await request.json(), { confirmations });
  return NextResponse.json(result, { status: result.accepted ? 200 : 422 });
}
