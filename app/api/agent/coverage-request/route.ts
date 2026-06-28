import { NextResponse } from "next/server";
import { handleAgentCoverageRequest } from "@/lib/agent-coverage";
import { CoverageQuoteValidationError } from "@/lib/coverage-products";
import { dynamicCoverageRequestSchema } from "@/lib/http-schemas";
import { createDynamicPricingJob, PricingQueueFullError } from "@/lib/operator-research-pricing";
import { getPolicyStore } from "@/lib/policy-store-factory";
import { intakeLimiter, rateLimit } from "@/lib/api-rate-limit";

export async function POST(request: Request) {
  const limited = rateLimit(request, intakeLimiter);
  if (limited) return limited;
  const raw = await request.json();

  if ((raw as { pricing?: unknown })?.pricing === "dynamic") {
    const parsed = dynamicCoverageRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { accepted: false, reasonCode: "invalid_request", message: parsed.error.issues[0]?.message },
        { status: 400 }
      );
    }
    try {
      const { pricing: _pricing, ...input } = parsed.data;
      const result = await createDynamicPricingJob(input as never, {
        store: getPolicyStore(),
        now: new Date().toISOString()
      });
      return NextResponse.json({ accepted: true, reasonCode: "pricing_pending", ...result }, { status: 202 });
    } catch (error) {
      if (error instanceof CoverageQuoteValidationError) {
        return NextResponse.json(
          { accepted: false, reasonCode: error.reasonCode, message: error.message },
          { status: 400 }
        );
      }
      if (error instanceof PricingQueueFullError) {
        return NextResponse.json(
          { accepted: false, reasonCode: error.reasonCode, message: error.message },
          { status: 429, headers: { "Retry-After": "30" } }
        );
      }
      throw error;
    }
  }

  const result = handleAgentCoverageRequest(raw);
  return NextResponse.json(result, { status: result.accepted ? 200 : 422 });
}
