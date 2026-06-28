import { NextResponse } from "next/server";
import { AeroDataBoxError, lookupAeroDataBoxFlights } from "@/lib/aerodatabox";
import { lookupLimiter, rateLimit } from "@/lib/api-rate-limit";

export async function GET(request: Request) {
  const limited = rateLimit(request, lookupLimiter);
  if (limited) return limited;
  const params = new URL(request.url).searchParams;

  try {
    const results = await lookupAeroDataBoxFlights({
      flightNumber: params.get("flightNumber") ?? "",
      date: params.get("date") ?? ""
    });
    return NextResponse.json({ results });
  } catch (error) {
    const status = error instanceof AeroDataBoxError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Unable to look up flight details.";
    return NextResponse.json({ results: [], message }, { status });
  }
}
