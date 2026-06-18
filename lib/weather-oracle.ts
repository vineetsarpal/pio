import type { CoverageRequest, WeatherEvidence, WeatherEvidenceMetadata, WeatherObservation } from "./types";
import { demoWeatherEvidence } from "./demo-fixtures";

const NORMALIZATION_VERSION = "pio-weather-normalizer-v1";

export interface WeatherOracle {
  readonly source: WeatherEvidence["source"];
  getRainfall(request: CoverageRequest): Promise<WeatherEvidence>;
}

export class DemoReplayWeatherOracle implements WeatherOracle {
  readonly source = "demo_replay" as const;

  async getRainfall(): Promise<WeatherEvidence> {
    return demoWeatherEvidence;
  }
}

export class OpenMeteoWeatherOracle implements WeatherOracle {
  readonly source = "open_meteo" as const;

  async getRainfall(request: CoverageRequest): Promise<WeatherEvidence> {
    const startDate = request.eventStart.slice(0, 10);
    const endDate = request.eventEnd.slice(0, 10);
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(request.latitude));
    url.searchParams.set("longitude", String(request.longitude));
    url.searchParams.set("hourly", "rain");
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Open-Meteo request failed with ${response.status}.`);
    }

    const payload = (await response.json()) as {
      hourly?: {
        time?: string[];
        rain?: Array<number | null>;
      };
    };
    const observations = normalizeOpenMeteoHourlyRain(payload);

    return {
      source: this.source,
      metadata: buildOpenMeteoMetadata(url, observations),
      observations
    };
  }
}

export function normalizeOpenMeteoHourlyRain(payload: {
  hourly?: {
    time?: string[];
    rain?: Array<number | null>;
  };
}): WeatherObservation[] {
  const times = payload.hourly?.time ?? [];
  const rain = payload.hourly?.rain ?? [];

  return times.map((time, index) => ({
    observedAt: time,
    rainfallMm: rain[index] ?? null
  }));
}

function buildOpenMeteoMetadata(url: URL, observations: WeatherObservation[]): WeatherEvidenceMetadata {
  return {
    settlementGrade: false,
    advisoryOnly: true,
    snapshotId: `wx-open-meteo-${url.searchParams.get("latitude")}-${url.searchParams.get("longitude")}-${url.searchParams.get("start_date")}`,
    capturedAt: new Date().toISOString(),
    sourceUrl: url.toString(),
    requestParams: Object.fromEntries(url.searchParams.entries()),
    normalizationVersion: NORMALIZATION_VERSION,
    missingDataPolicy: "fail_closed_manual_review",
    missingObservationCount: observations.filter((observation) => observation.rainfallMm === null).length
  };
}

export function createWeatherOracle(mode: WeatherEvidence["source"] = "demo_replay"): WeatherOracle {
  if (mode === "open_meteo") return new OpenMeteoWeatherOracle();
  return new DemoReplayWeatherOracle();
}
