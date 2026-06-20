import { NextResponse } from "next/server";
import { PioQuoteValidationError, createPioQuote, type PioQuoteRequest } from "@/lib/pio-quote-engine";

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as PioQuoteRequest;
    const quote = createPioQuote(input);

    return NextResponse.json({
      accepted: true,
      reasonCode: "quote_ready",
      quote
    });
  } catch (error) {
    if (error instanceof PioQuoteValidationError) {
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
        reasonCode: "quote_failed",
        message: error instanceof Error ? error.message : "Unable to create PIO quote."
      },
      { status: 400 }
    );
  }
}
