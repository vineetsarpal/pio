import { NextResponse } from "next/server";
import { runGaugeDemoWorkflow } from "@/lib/gauge-tools";

export async function GET() {
  const run = await runGaugeDemoWorkflow();
  return NextResponse.json(run);
}
