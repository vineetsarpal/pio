import { NextResponse } from "next/server";
import type { CoverageRequest } from "@/lib/types";
import { quotePolicy } from "@/lib/workflow";

export async function POST(request: Request) {
  const coverageRequest = (await request.json()) as CoverageRequest;

  try {
    const policy = quotePolicy(coverageRequest);
    return NextResponse.json({ policy });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to quote policy." },
      { status: 400 }
    );
  }
}
