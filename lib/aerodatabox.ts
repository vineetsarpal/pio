export type FlightLookupResult = {
  id: string;
  flightNumber: string;
  airline: string;
  originAirport: string;
  originName: string;
  destinationAirport: string;
  destinationName: string;
  departureTime: string;
  arrivalTime: string;
  status: string;
  departureDelayMinutes: number;
  arrivalDelayMinutes: number;
};

export class AeroDataBoxError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export async function lookupAeroDataBoxFlights({
  flightNumber,
  date,
  apiKey = process.env.AERODATABOX_RAPIDAPI_KEY
}: {
  flightNumber: string;
  date: string;
  apiKey?: string;
}): Promise<FlightLookupResult[]> {
  if (!apiKey) {
    throw new AeroDataBoxError("AeroDataBox is not configured.", 503);
  }

  const normalizedNumber = normalizeFlightNumber(flightNumber);
  if (!normalizedNumber || !isIsoDate(date)) {
    throw new AeroDataBoxError("A valid flight number and departure date are required.", 400);
  }

  const url = new URL(
    `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(normalizedNumber)}/${date}`
  );
  url.searchParams.set("dateLocalRole", "Departure");

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-RapidAPI-Key": apiKey,
        "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com"
      },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(8_000)
    });
  } catch {
    throw new AeroDataBoxError("Flight lookup is temporarily unavailable.", 502);
  }

  if (response.status === 404) return [];
  if (response.status === 429) {
    throw new AeroDataBoxError("Flight lookup rate limit reached. Try again shortly.", 503);
  }
  if (!response.ok) {
    throw new AeroDataBoxError(`AeroDataBox returned ${response.status}.`, 502);
  }

  return parseAeroDataBoxFlights(await response.json());
}

export function parseAeroDataBoxFlights(json: unknown): FlightLookupResult[] {
  if (!Array.isArray(json)) return [];

  return json.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const departure = recordValue(item.departure);
    const arrival = recordValue(item.arrival);
    const departureAirport = recordValue(departure.airport);
    const arrivalAirport = recordValue(arrival.airport);
    const airline = recordValue(item.airline);
    const departureScheduled = movementTime(departure, "scheduledTime");
    const arrivalScheduled = movementTime(arrival, "scheduledTime");
    const flightNumber = stringValue(item.number);
    const originAirport = stringValue(departureAirport.iata);
    const destinationAirport = stringValue(arrivalAirport.iata);

    if (!flightNumber || !originAirport || !destinationAirport || !departureScheduled || !arrivalScheduled) {
      return [];
    }

    const departureActual = movementTime(departure, "actualTime") ?? movementTime(departure, "revisedTime");
    const arrivalActual = movementTime(arrival, "actualTime") ?? movementTime(arrival, "revisedTime");
    const id =
      stringValue(item.callSign) ??
      `${flightNumber}-${originAirport}-${destinationAirport}-${departureScheduled}-${index}`;

    return [
      {
        id,
        flightNumber,
        airline: stringValue(airline.name) ?? flightNumber.replace(/\d.*$/, ""),
        originAirport,
        originName: stringValue(departureAirport.name) ?? originAirport,
        destinationAirport,
        destinationName: stringValue(arrivalAirport.name) ?? destinationAirport,
        departureTime: departureScheduled,
        arrivalTime: arrivalScheduled,
        status: stringValue(item.status) ?? "Unknown",
        departureDelayMinutes: delayMinutes(departureScheduled, departureActual),
        arrivalDelayMinutes: delayMinutes(arrivalScheduled, arrivalActual)
      }
    ];
  });
}

export function normalizeFlightNumber(value: string): string | undefined {
  const normalized = value.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(normalized) ? normalized : undefined;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function movementTime(movement: Record<string, unknown>, key: string): string | undefined {
  const time = recordValue(movement[key]);
  return stringValue(time.local) ?? stringValue(time.utc);
}

function delayMinutes(scheduled: string, actual?: string): number {
  if (!actual) return 0;
  const scheduledAt = new Date(scheduled).getTime();
  const actualAt = new Date(actual).getTime();
  if (!Number.isFinite(scheduledAt) || !Number.isFinite(actualAt)) return 0;
  return Math.max(0, Math.round((actualAt - scheduledAt) / 60_000));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
