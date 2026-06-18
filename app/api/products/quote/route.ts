import { NextResponse } from "next/server";
import type { ProductQuoteInput } from "@/lib/coverage-products";
import { quoteCoverageProduct } from "@/lib/coverage-products";

export async function POST(request: Request) {
  const input = (await request.json()) as ProductQuoteInput;

  try {
    const quote = await quoteCoverageProduct(input);
    return NextResponse.json({
      accepted: true,
      reasonCode: "product_quote_ready",
      quote
    });
  } catch (error) {
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
