export type GeocodeResult = { lat: number; lng: number; label: string };

export function parseNominatimSearch(json: unknown): GeocodeResult[] {
  if (!Array.isArray(json)) return [];

  const results: GeocodeResult[] = [];
  for (const item of json) {
    if (typeof item !== "object" || item === null) continue;
    const { lat, lon, display_name: label } = item as Record<string, unknown>;
    const latN = Number(lat);
    const lngN = Number(lon);
    if (Number.isFinite(latN) && Number.isFinite(lngN) && typeof label === "string" && label.length > 0) {
      results.push({ lat: latN, lng: lngN, label });
    }
  }
  return results;
}

export function parseNominatimReverse(json: unknown): { label: string } | undefined {
  if (typeof json !== "object" || json === null) return undefined;
  const label = (json as Record<string, unknown>).display_name;
  return typeof label === "string" && label.length > 0 ? { label } : undefined;
}
