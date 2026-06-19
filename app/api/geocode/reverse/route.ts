import { NextResponse } from "next/server";
import { parseNominatimReverse } from "@/lib/geocode";

const NOMINATIM_UA = "pio/1.0 (rain-cover demo)";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = params.get("lat");
  const lon = params.get("lon");
  if (!lat || !lon) {
    return NextResponse.json({ label: null }, { status: 400 });
  }
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
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
