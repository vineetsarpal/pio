import { NextResponse } from "next/server";
import { parseNominatimReverse } from "@/lib/geocode";
import { parseQuery, reverseGeocodeQuerySchema } from "@/lib/http-schemas";
import { lookupLimiter, rateLimit } from "@/lib/api-rate-limit";

const NOMINATIM_UA = "pio/1.0 (rain-cover demo)";

export async function GET(request: Request) {
  const limited = rateLimit(request, lookupLimiter);
  if (limited) return limited;
  const parsed = parseQuery(request.url, reverseGeocodeQuerySchema);
  if (!parsed.ok) {
    return NextResponse.json({ label: null }, { status: 400 });
  }
  const { lat, lon } = parsed.data;
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`;
  try {
    const response = await fetch(url, { headers: { "User-Agent": NOMINATIM_UA } });
    if (!response.ok) {
      return NextResponse.json({ label: null }, { status: 502 });
    }
    return NextResponse.json({ label: parseNominatimReverse(await response.json())?.label ?? null });
  } catch {
    return NextResponse.json({ label: null }, { status: 502 });
  }
}
