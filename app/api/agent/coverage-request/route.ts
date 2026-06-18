import { NextResponse } from "next/server";
import { handleAgentCoverageRequest } from "@/lib/agent-coverage";

export async function POST(request: Request) {
  const result = handleAgentCoverageRequest(await request.json());
  return NextResponse.json(result, { status: result.accepted ? 200 : 422 });
}
