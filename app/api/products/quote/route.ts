import { NextResponse } from "next/server";
import type { ProductQuoteInput } from "@/lib/coverage-products";
import {
  CoverageQuoteValidationError,
  DemoFlightStatusPricingApi,
  DemoWeatherPricingApi,
  quoteCoverageProduct
} from "@/lib/coverage-products";
import { parseJsonBody, productQuoteInputSchema } from "@/lib/http-schemas";

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, productQuoteInputSchema);
  if (!parsed.ok) {
    return NextResponse.json(
      { accepted: false, reasonCode: "invalid_request", message: parsed.message },
      { status: 400 }
    );
  }

  try {
    const demoPricing = new URL(request.url).searchParams.get("pricing") === "demo";
    const quote = await quoteCoverageProduct(
      parsed.data as ProductQuoteInput,
      demoPricing
        ? {
            weather: new DemoWeatherPricingApi(),
            flight: new DemoFlightStatusPricingApi()
          }
        : undefined
    );
    return NextResponse.json({
      accepted: true,
      reasonCode: "product_quote_ready",
      quote
    });
  } catch (error) {
    if (error instanceof CoverageQuoteValidationError) {
      return NextResponse.json(
        {
          accepted: false,
          reasonCode: error.reasonCode,
          message: error.message
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        accepted: false,
        reasonCode: "product_quote_failed",
        message: error instanceof Error ? error.message : "Unable to quote coverage product."
      },
      { status: 400 }
    );
  }
}
