import { NextResponse } from "next/server";
import { parseNominatimSearch } from "@/lib/geocode";
import { lookupLimiter, rateLimit } from "@/lib/api-rate-limit";

const NOMINATIM_UA = "pio/1.0 (rain-cover demo)";

export async function GET(request: Request) {
  const limited = rateLimit(request, lookupLimiter);
  if (limited) return limited;
  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ results: [] });
  }
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`;
  try {
    const response = await fetch(url, { headers: { "User-Agent": NOMINATIM_UA } });
    if (!response.ok) {
      return NextResponse.json({ results: [] }, { status: 502 });
    }
    return NextResponse.json({ results: parseNominatimSearch(await response.json()) });
  } catch {
    return NextResponse.json({ results: [] }, { status: 502 });
  }
}
