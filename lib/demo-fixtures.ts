import type { CoverageRequest, WeatherEvidence } from "./types";

export const demoCoverageRequest: CoverageRequest = {
  customerName: "North Pier Pop-up Market",
  eventName: "Saturday Harbor Market",
  locationName: "Toronto Waterfront",
  latitude: 43.6405,
  longitude: -79.3764,
  eventStart: "2026-06-20T12:00:00-04:00",
  eventEnd: "2026-06-20T18:00:00-04:00",
  desiredPayout: {
    amount: 500,
    currency: "USD"
  },
  maximumPremium: {
    amount: 75,
    currency: "USD"
  }
};

export const demoWeatherEvidence: WeatherEvidence = {
  source: "demo_replay",
  metadata: {
    settlementGrade: true,
    advisoryOnly: false,
    snapshotId: "wx-demo-rain-2026-06-20-toronto-waterfront",
    capturedAt: "2026-06-17T18:10:00-04:00",
    sourceUrl: "pio://demo-weather-replay/rain-cover/toronto-waterfront",
    requestParams: {
      latitude: "43.6405",
      longitude: "-79.3764",
      hourly: "rain",
      timezone: "America/Toronto",
      start_date: "2026-06-20",
      end_date: "2026-06-20"
    },
    normalizationVersion: "pio-weather-normalizer-v1",
    missingDataPolicy: "fail_closed_manual_review",
    missingObservationCount: 0
  },
  observations: [
    { observedAt: "2026-06-20T11:00:00-04:00", rainfallMm: 2.4 },
    { observedAt: "2026-06-20T12:00:00-04:00", rainfallMm: 0.7 },
    { observedAt: "2026-06-20T13:00:00-04:00", rainfallMm: 1.1 },
    { observedAt: "2026-06-20T14:00:00-04:00", rainfallMm: 0.9 },
    { observedAt: "2026-06-20T15:00:00-04:00", rainfallMm: 1.8 },
    { observedAt: "2026-06-20T16:00:00-04:00", rainfallMm: 1.0 },
    { observedAt: "2026-06-20T17:00:00-04:00", rainfallMm: 0.6 },
    { observedAt: "2026-06-20T18:00:00-04:00", rainfallMm: 0.4 },
    { observedAt: "2026-06-20T19:00:00-04:00", rainfallMm: 4.6 }
  ]
};
