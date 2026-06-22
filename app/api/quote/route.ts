import { NextResponse } from "next/server";
import type { CoverageRequest } from "@/lib/types";
import { quotePolicy } from "@/lib/workflow";
import { coverageRequestSchema, parseJsonBody } from "@/lib/http-schemas";

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, coverageRequestSchema);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.message }, { status: 400 });
  }

  try {
    const policy = quotePolicy(parsed.data as CoverageRequest);
    return NextResponse.json({ policy });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to quote policy." },
      { status: 400 }
    );
  }
}
