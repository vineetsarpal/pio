import type { CoverageProductId, Money, Policy, WeatherEvidence } from "./types";
import { lookupAeroDataBoxFlights, type FlightLookupResult } from "./aerodatabox";
import { calculatePremium } from "./premium-pricing";

const USD = (amount: number): Money => ({ amount, currency: "USD" });

export type CoverageQuoteFailureCode =
  | "invalid_dates"
  | "unsupported_location"
  | "invalid_coverage"
  | "expired_quote";

export class CoverageQuoteValidationError extends Error {
  constructor(readonly reasonCode: CoverageQuoteFailureCode, message: string) {
    super(message);
    this.name = "CoverageQuoteValidationError";
  }
}

const COVERAGE_MIN = 100;
const COVERAGE_MAX = 50_000;
const MAX_WINDOW_HOURS = 168;
const QUOTE_TTL_MS = 15 * 60 * 1000;

function validateCoverageAmount(payout: Money): void {
  if (!Number.isFinite(payout.amount) || payout.amount < COVERAGE_MIN || payout.amount > COVERAGE_MAX) {
    throw new CoverageQuoteValidationError(
      "invalid_coverage",
      `desiredPayout.amount must be between ${COVERAGE_MIN} and ${COVERAGE_MAX}.`
    );
  }
}

function validateWindow(start: string, end: string, now: Date): void {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    throw new CoverageQuoteValidationError(
      "invalid_dates",
      "Coverage window must have valid start and end dates with end after start."
    );
  }
  if (endMs <= now.getTime()) {
    throw new CoverageQuoteValidationError(
      "expired_quote",
      "Coverage window ends in the past; request a future window."
    );
  }
  if ((endMs - startMs) / 3_600_000 > MAX_WINDOW_HOURS) {
    throw new CoverageQuoteValidationError(
      "invalid_dates",
      `Coverage windows longer than ${MAX_WINDOW_HOURS} hours are not supported.`
    );
  }
}

function validateCoordinates(latitude: number, longitude: number): void {
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new CoverageQuoteValidationError(
      "unsupported_location",
      "location coordinates must be valid latitude/longitude values."
    );
  }
}

function quoteExpiry(now: Date): string {
  return new Date(now.getTime() + QUOTE_TTL_MS).toISOString();
}

export type RainEventQuoteInput = {
  productId: "rain_event";
  customerName: string;
  eventName: string;
  locationName: string;
  latitude: number;
  longitude: number;
  eventStart: string;
  eventEnd: string;
  desiredPayout: Money;
  deductible?: Money;
  maximumPremium?: Money;
};

export type FlightDelayQuoteInput = {
  productId: "flight_delay";
  customerName: string;
  passengerName: string;
  airline: string;
  flightNumber: string;
  originAirport: string;
  destinationAirport: string;
  departureTime: string;
  arrivalTime: string;
  desiredPayout: Money;
  deductible?: Money;
  maximumPremium?: Money;
};

export type ProductQuoteInput = RainEventQuoteInput | FlightDelayQuoteInput;

export type RiskAssessment = {
  productId: CoverageProductId;
  source: string;
  sourceLabel: string;
  apiStatus: "live" | "demo_fallback" | "demo";
  apiCall: ApiCallTelemetry;
  score: number;
  pricingAdjustment: number;
  factors: string[];
  observedMetric: {
    label: string;
    value: string;
  };
};

export type ApiCallTelemetry = {
  toolName: string;
  method: "GET" | "POST" | "SIMULATED";
  endpoint: string;
  status: "success" | "fallback" | "simulated";
  calledAt: string;
  latencyMs: number;
  purpose: string;
};

export type PolicyPacket = {
  certificateId: string;
  title: string;
  insured: string;
  coverageSummary: string;
  deductibleSummary: string;
  triggerSummary: string;
  premiumSummary: string;
  dataSources: string[];
  exclusions: string[];
  issueCondition: string;
};

export type ProductQuote = {
  product: {
    id: CoverageProductId;
    name: string;
    tagline: string;
  };
  policy: Policy;
  risk: RiskAssessment;
  packet: PolicyPacket;
  expiresAt: string;
  agentNarrative: string[];
};

export interface ProductRiskAdapters {
  weather?: WeatherPricingApi;
  flight?: FlightStatusPricingApi;
}

export interface WeatherPricingApi {
  getRainEventRisk(input: RainEventQuoteInput): Promise<RiskAssessment>;
}

export interface FlightStatusPricingApi {
  getFlightDelayRisk(input: FlightDelayQuoteInput): Promise<RiskAssessment>;
}

export const coverageProducts = [
  {
    id: "rain_event" as const,
    name: "Rain event protection",
    tagline: "Fixed payout if rain crosses the covered event trigger.",
    api: "Weather API",
    trigger: "Rainfall total > 5 mm"
  },
  {
    id: "flight_delay" as const,
    name: "Flight delay protection",
    tagline: "Fixed payout when arrival delay exceeds the covered threshold.",
    api: "Flight status API",
    trigger: "Arrival delay > 90 minutes"
  }
];

export async function quoteCoverageProduct(
  input: ProductQuoteInput,
  adapters: ProductRiskAdapters = {},
  options: { now?: Date } = {}
): Promise<ProductQuote> {
  const now = options.now ?? new Date();
  assertUsd(input.desiredPayout, "desiredPayout");
  if (input.maximumPremium) assertUsd(input.maximumPremium, "maximumPremium");
  validateCoverageAmount(input.desiredPayout);

  if (input.productId === "rain_event") {
    validateCoordinates(input.latitude, input.longitude);
    validateWindow(input.eventStart, input.eventEnd, now);
    const weather = adapters.weather ?? new OpenMeteoPricingApi();
    const risk = await weather.getRainEventRisk(input);
    const deductible = input.deductible ?? USD(0);
    const payout = payoutAfterDeductible(input.desiredPayout, deductible);
    const premium = calculatePremium(
      input.productId,
      payout.amount,
      risk.pricingAdjustment,
      eventHours(input.eventStart, input.eventEnd)
    );
    enforcePremiumCap(premium, input.maximumPremium);
    const policy = buildRainPolicy(input, premium, risk, deductible, payout);
    return buildQuote(input.productId, policy, risk, buildRainPacket(policy, risk), quoteExpiry(now));
  }

  validateWindow(input.departureTime, input.arrivalTime, now);
  const flight = adapters.flight ?? new AeroDataBoxFlightStatusPricingApi();
  const risk = await flight.getFlightDelayRisk(input);
  const deductible = input.deductible ?? USD(0);
  const payout = payoutAfterDeductible(input.desiredPayout, deductible);
  const premium = calculatePremium(
    input.productId,
    payout.amount,
    risk.pricingAdjustment,
    flightHours(input.departureTime, input.arrivalTime)
  );
  enforcePremiumCap(premium, input.maximumPremium);
  const policy = buildFlightPolicy(input, premium, risk, deductible, payout);
  return buildQuote(input.productId, policy, risk, buildFlightPacket(policy, risk, input), quoteExpiry(now));
}

export class OpenMeteoPricingApi implements WeatherPricingApi {
  async getRainEventRisk(input: RainEventQuoteInput): Promise<RiskAssessment> {
    const calledAt = new Date().toISOString();
    const startedAt = Date.now();
    const startDate = input.eventStart.slice(0, 10);
    const endDate = input.eventEnd.slice(0, 10);
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(input.latitude));
    url.searchParams.set("longitude", String(input.longitude));
    url.searchParams.set("hourly", "rain");
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}`);
      const payload = (await response.json()) as {
        hourly?: {
          time?: string[];
          rain?: Array<number | null>;
        };
      };
      const rainTotal = sumRainInWindow(payload, input.eventStart, input.eventEnd);
      return rainRiskFromTotal(
        rainTotal,
        url.toString(),
        "live",
        buildApiCallTelemetry({
          toolName: "Open-Meteo weather API",
          method: "GET",
          endpoint: url.toString(),
          status: "success",
          calledAt,
          startedAt,
          purpose: "Fetch hourly rainfall forecast for event-window premium pricing."
        })
      );
    } catch {
      const fallbackTotal = fallbackRainTotal(input);
      const endpoint = "pio://demo-weather-pricing-api/fallback-rain-risk";
      return rainRiskFromTotal(
        fallbackTotal,
        endpoint,
        "demo_fallback",
        buildApiCallTelemetry({
          toolName: "Demo weather pricing API",
          method: "SIMULATED",
          endpoint,
          status: "fallback",
          calledAt,
          startedAt,
          purpose: "Use deterministic weather fallback when live weather pricing is unavailable."
        })
      );
    }
  }
}

export class DemoWeatherPricingApi implements WeatherPricingApi {
  async getRainEventRisk(input: RainEventQuoteInput): Promise<RiskAssessment> {
    const calledAt = new Date().toISOString();
    const startedAt = Date.now();
    const endpoint = "pio://demo-weather-pricing-api/rain-risk";

    return rainRiskFromTotal(
      fallbackRainTotal(input),
      endpoint,
      "demo",
      buildApiCallTelemetry({
        toolName: "Demo weather pricing API",
        method: "SIMULATED",
        endpoint,
        status: "simulated",
        calledAt,
        startedAt,
        purpose: "Use deterministic weather risk for quote-flow testing without an external API call."
      })
    );
  }
}

export class DemoFlightStatusPricingApi implements FlightStatusPricingApi {
  async getFlightDelayRisk(input: FlightDelayQuoteInput): Promise<RiskAssessment> {
    const calledAt = new Date().toISOString();
    const startedAt = Date.now();
    const profile = flightRiskProfile(input);

    return {
      productId: "flight_delay",
      source: `pio://demo-flight-status-api/routes/${profile.routeKey}`,
      sourceLabel: "Demo flight status API",
      apiStatus: "demo",
      apiCall: buildApiCallTelemetry({
        toolName: "Demo flight status API",
        method: "SIMULATED",
        endpoint: `pio://demo-flight-status-api/routes/${profile.routeKey}`,
        status: "simulated",
        calledAt,
        startedAt,
        purpose: "Retrieve route delay profile for flight-delay premium pricing."
      }),
      score: profile.score,
      pricingAdjustment: 0.025 + profile.probability * 0.075,
      factors: profile.factors,
      observedMetric: {
        label: "Estimated delay probability",
        value: `${profile.score}%`
      }
    };
  }
}

type FlightLookup = (input: { flightNumber: string; date: string }) => Promise<FlightLookupResult[]>;

export class AeroDataBoxFlightStatusPricingApi implements FlightStatusPricingApi {
  constructor(private readonly lookup: FlightLookup = lookupAeroDataBoxFlights) {}

  async getFlightDelayRisk(input: FlightDelayQuoteInput): Promise<RiskAssessment> {
    const calledAt = new Date().toISOString();
    const startedAt = Date.now();
    const date = input.departureTime.slice(0, 10);
    const flightNumber = input.flightNumber.replace(/\s+/g, "").toUpperCase();
    const endpoint = `https://aerodatabox.p.rapidapi.com/flights/number/${encodeURIComponent(flightNumber)}/${date}?dateLocalRole=Departure`;

    try {
      const flights = await this.lookup({ flightNumber, date });
      const flight = flights.find(
        (candidate) =>
          candidate.originAirport === input.originAirport.toUpperCase() &&
          candidate.destinationAirport === input.destinationAirport.toUpperCase()
      );
      if (!flight) throw new Error("AeroDataBox did not return the selected itinerary.");

      const profile = flightRiskProfile(input);
      const observedDelay = Math.max(flight.departureDelayMinutes, flight.arrivalDelayMinutes);
      const liveDelayAdjustment = observedDelay >= 90 ? 0.2 : observedDelay >= 30 ? 0.08 : 0;
      const probability = clamp(profile.probability + liveDelayAdjustment, 0.08, 0.95);
      const score = Math.round(probability * 100);

      return {
        productId: "flight_delay",
        source: endpoint,
        sourceLabel: "AeroDataBox flight status API",
        apiStatus: "live",
        apiCall: buildApiCallTelemetry({
          toolName: "AeroDataBox flight status API",
          method: "GET",
          endpoint,
          status: "success",
          calledAt,
          startedAt,
          purpose: "Verify the selected itinerary and current flight status for premium pricing."
        }),
        score,
        pricingAdjustment: 0.025 + probability * 0.075,
        factors: [
          `${flight.flightNumber} verified by AeroDataBox as ${flight.status.toLowerCase()}`,
          observedDelay > 0 ? `Current observed delay ${observedDelay} minutes` : "No current delay reported",
          ...profile.factors
        ],
        observedMetric: {
          label: "Estimated delay probability",
          value: `${score}%`
        }
      };
    } catch {
      const fallback = await new DemoFlightStatusPricingApi().getFlightDelayRisk(input);
      return {
        ...fallback,
        apiStatus: "demo_fallback",
        apiCall: {
          ...fallback.apiCall,
          status: "fallback",
          purpose: "Use deterministic route risk when live AeroDataBox verification is unavailable."
        }
      };
    }
  }
}

function buildQuote(
  productId: CoverageProductId,
  policy: Policy,
  risk: RiskAssessment,
  packet: PolicyPacket,
  expiresAt: string
): ProductQuote {
  const product = coverageProducts.find((candidate) => candidate.id === productId);
  if (!product) throw new Error(`Unsupported coverage product ${productId}.`);

  return {
    product: {
      id: product.id,
      name: product.name,
      tagline: product.tagline
    },
    policy,
    risk,
    packet,
    expiresAt,
    agentNarrative: [
      `Hermes selected ${product.name} and called the ${risk.sourceLabel}.`,
      `The risk score is ${risk.score}/100 based on ${risk.observedMetric.label.toLowerCase()} of ${risk.observedMetric.value}.`,
      `PIO priced a $${policy.premium.amount} premium for a fixed $${policy.payout.amount} payout${
        (policy.deductible?.amount ?? 0) > 0 ? ` after the $${policy.deductible?.amount} deductible` : ""
      }.`
    ]
  };
}

function stableIdParts(input: ProductQuoteInput, deductible: Money): string[] {
  if (input.productId === "rain_event") {
    return [input.productId, input.customerName, input.eventName, input.locationName,
      input.eventStart, input.eventEnd, String(input.desiredPayout.amount), String(deductible.amount)];
  }
  return [input.productId, input.customerName, input.passengerName, input.airline, input.flightNumber,
    input.originAirport, input.destinationAirport, input.departureTime,
    String(input.desiredPayout.amount), String(deductible.amount)];
}

export function productQuoteId(input: ProductQuoteInput): string {
  const deductible = input.deductible ?? USD(0);
  const stableId = stablePolicyId(stableIdParts(input, deductible));
  return input.productId === "rain_event" ? `pio-pol-rain-${stableId}` : `pio-pol-flight-${stableId}`;
}

export function validateProductQuoteInput(input: ProductQuoteInput, now: Date): void {
  assertUsd(input.desiredPayout, "desiredPayout");
  if (input.maximumPremium) assertUsd(input.maximumPremium, "maximumPremium");
  validateCoverageAmount(input.desiredPayout);
  if (input.productId === "rain_event") {
    validateCoordinates(input.latitude, input.longitude);
    validateWindow(input.eventStart, input.eventEnd, now);
  } else {
    validateWindow(input.departureTime, input.arrivalTime, now);
  }
}

function buildRainPolicy(
  input: RainEventQuoteInput,
  premium: Money,
  risk: RiskAssessment,
  deductible: Money,
  payout: Money
): Policy {
  const stableId = stablePolicyId(stableIdParts(input, deductible));

  return {
    id: `pio-pol-rain-${stableId}`,
    certificateId: `PIO-RAIN-${stableId.toUpperCase()}`,
    productId: "rain_event",
    customerName: input.customerName,
    eventName: input.eventName,
    locationName: input.locationName,
    premium,
    coverageAmount: input.desiredPayout,
    deductible,
    payout,
    trigger: {
      variable: "rainfall_mm",
      operator: ">",
      threshold: 5,
      aggregation: "sum",
      window: {
        start: input.eventStart,
        end: input.eventEnd
      }
    },
    weatherOracleSource: risk.apiStatus === "live" ? "open_meteo" : "demo_replay",
    riskSource: risk.source,
    riskScore: risk.score,
    riskFactors: risk.factors,
    status: "policy_quoted"
  };
}

function buildFlightPolicy(
  input: FlightDelayQuoteInput,
  premium: Money,
  risk: RiskAssessment,
  deductible: Money,
  payout: Money
): Policy {
  const stableId = stablePolicyId(stableIdParts(input, deductible));

  return {
    id: `pio-pol-flight-${stableId}`,
    certificateId: `PIO-FLIGHT-${stableId.toUpperCase()}`,
    productId: "flight_delay",
    customerName: input.customerName,
    eventName: `${input.airline} ${input.flightNumber}`,
    locationName: `${input.originAirport.toUpperCase()} to ${input.destinationAirport.toUpperCase()}`,
    premium,
    coverageAmount: input.desiredPayout,
    deductible,
    payout,
    trigger: {
      variable: "arrival_delay_minutes",
      operator: ">",
      threshold: 90,
      aggregation: "max",
      window: {
        start: input.departureTime,
        end: input.arrivalTime
      }
    },
    weatherOracleSource: "demo_replay",
    riskSource: risk.source,
    riskScore: risk.score,
    riskFactors: risk.factors,
    status: "policy_quoted"
  };
}

function buildRainPacket(policy: Policy, risk: RiskAssessment): PolicyPacket {
  return {
    certificateId: policy.certificateId,
    title: "Parametric rain event protection packet",
    insured: policy.customerName,
    coverageSummary: `$${(policy.coverageAmount ?? policy.payout).amount}`,
    deductibleSummary: `$${policy.deductible?.amount ?? 0}`,
    triggerSummary: `Normalized rainfall exceeds ${policy.trigger.threshold} mm between ${policy.trigger.window.start} and ${policy.trigger.window.end}.`,
    premiumSummary: `$${policy.premium.amount} premium.`,
    dataSources: [risk.sourceLabel, risk.source],
    exclusions: ["Demo coverage only", "No payout from incomplete or advisory settlement evidence without review"],
    issueCondition: "Policy packet issues after Stripe test-mode premium collection is verified by webhook."
  };
}

function buildFlightPacket(policy: Policy, risk: RiskAssessment, input: FlightDelayQuoteInput): PolicyPacket {
  return {
    certificateId: policy.certificateId,
    title: "Parametric flight delay protection packet",
    insured: input.passengerName || policy.customerName,
    coverageSummary: `$${(policy.coverageAmount ?? policy.payout).amount}`,
    deductibleSummary: `$${policy.deductible?.amount ?? 0}`,
    triggerSummary: `Arrival delay exceeds ${policy.trigger.threshold} minutes.`,
    premiumSummary: `$${policy.premium.amount} premium.`,
    dataSources: [risk.sourceLabel, risk.source],
    exclusions: ["Demo coverage only", "Cancellations, diversions, and missed connections require separate coverage wording"],
    issueCondition: "Policy packet issues after Stripe test-mode premium collection is verified by webhook."
  };
}

function payoutAfterDeductible(coverageAmount: Money, deductible: Money): Money {
  assertUsd(deductible, "deductible");
  if (!Number.isFinite(deductible.amount) || deductible.amount < 0) {
    throw new Error("deductible must be a non-negative amount.");
  }
  if (deductible.amount >= coverageAmount.amount) {
    throw new Error("deductible must be less than the coverage amount.");
  }
  return USD(coverageAmount.amount - deductible.amount);
}

function enforcePremiumCap(premium: Money, maximumPremium?: Money): void {
  if (maximumPremium && premium.amount > maximumPremium.amount) {
    throw new Error(`Premium ${premium.amount} exceeds the maximum budget ${maximumPremium.amount} for this coverage request.`);
  }
}

function rainRiskFromTotal(
  rainTotal: number,
  source: string,
  apiStatus: RiskAssessment["apiStatus"],
  apiCall: ApiCallTelemetry
): RiskAssessment {
  const score = Math.round(clamp(20 + rainTotal * 8, 12, 92));
  return {
    productId: "rain_event",
    source,
    sourceLabel: apiStatus === "live" ? "Open-Meteo weather API" : "Demo weather pricing API",
    apiStatus,
    apiCall,
    score,
    pricingAdjustment: 0.018 + score / 1000,
    factors: [
      `Forecast rainfall during covered window ${rainTotal.toFixed(1)} mm`,
      rainTotal > 5 ? "Covered event window is already above the payout trigger in forecast data" : "Covered event window is below trigger but still has weather volatility",
      "Short-duration outdoor event exposure"
    ],
    observedMetric: {
      label: "Forecast rainfall",
      value: `${rainTotal.toFixed(1)} mm`
    }
  };
}

function buildApiCallTelemetry({
  toolName,
  method,
  endpoint,
  status,
  calledAt,
  startedAt,
  purpose
}: {
  toolName: string;
  method: ApiCallTelemetry["method"];
  endpoint: string;
  status: ApiCallTelemetry["status"];
  calledAt: string;
  startedAt: number;
  purpose: string;
}): ApiCallTelemetry {
  return {
    toolName,
    method,
    endpoint,
    status,
    calledAt,
    latencyMs: Math.max(0, Date.now() - startedAt),
    purpose
  };
}

function sumRainInWindow(
  payload: { hourly?: { time?: string[]; rain?: Array<number | null> } },
  eventStart: string,
  eventEnd: string
): number {
  const times = payload.hourly?.time ?? [];
  const rain = payload.hourly?.rain ?? [];
  const start = new Date(eventStart).getTime();
  const end = new Date(eventEnd).getTime();

  return times.reduce((total, time, index) => {
    const observedAt = new Date(time).getTime();
    if (observedAt < start || observedAt > end) return total;
    return total + (rain[index] ?? 0);
  }, 0);
}

function fallbackRainTotal(input: RainEventQuoteInput): number {
  const location = input.locationName.toLowerCase();
  if (location.includes("waterfront") || location.includes("toronto")) return 6.5;
  if (location.includes("seattle") || location.includes("vancouver")) return 8.2;
  if (location.includes("phoenix") || location.includes("las vegas")) return 1.4;
  return 4.2;
}

function eventHours(start: string, end: string): number {
  return Math.max(1, (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000);
}

function flightHours(start: string, end: string): number {
  return Math.max(1, (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000);
}

function flightRiskProfile(input: FlightDelayQuoteInput): {
  routeKey: string;
  probability: number;
  score: number;
  factors: string[];
} {
  const routeKey = `${input.originAirport.trim().toUpperCase()}-${input.destinationAirport.trim().toUpperCase()}`;
  const routeProfile = demoFlightDelayProfiles[routeKey] ?? { probability: 0.28, averageDelayMinutes: 34 };
  const departureHour = new Date(input.departureTime).getHours();
  const lateDayPenalty = departureHour >= 16 ? 0.12 : departureHour >= 12 ? 0.06 : 0;
  const routeCongestion = congestedAirports.has(input.originAirport.trim().toUpperCase()) ? 0.08 : 0;
  const probability = clamp(routeProfile.probability + lateDayPenalty + routeCongestion, 0.08, 0.82);

  return {
    routeKey,
    probability,
    score: Math.round(probability * 100),
    factors: [
      `${routeKey} historical delay probability ${(routeProfile.probability * 100).toFixed(0)}%`,
      `Average observed delay ${routeProfile.averageDelayMinutes} minutes`,
      departureHour >= 16
        ? "Late-day departure increases missed-connection and rotation risk"
        : "Departure time has moderate schedule risk",
      routeCongestion > 0
        ? `${input.originAirport.toUpperCase()} congestion adjustment applied`
        : "No major origin congestion adjustment"
    ]
  };
}

function stablePolicyId(parts: string[]): string {
  const input = parts.join("|").toLowerCase();
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(31, hash) + input.charCodeAt(index);
  }
  return Math.abs(hash).toString(36).padStart(6, "0").slice(0, 8);
}

function assertUsd(money: Money, field: string): void {
  if (money.currency !== "USD") {
    throw new Error(`${field} must be denominated in USD for this demo.`);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const demoFlightDelayProfiles: Record<string, { probability: number; averageDelayMinutes: number }> = {
  "JFK-LAX": { probability: 0.42, averageDelayMinutes: 48 },
  "EWR-SFO": { probability: 0.46, averageDelayMinutes: 54 },
  "ORD-LGA": { probability: 0.39, averageDelayMinutes: 44 },
  "YYZ-YVR": { probability: 0.34, averageDelayMinutes: 37 },
  "YYZ-JFK": { probability: 0.31, averageDelayMinutes: 32 },
  "DFW-ATL": { probability: 0.24, averageDelayMinutes: 26 }
};

const congestedAirports = new Set(["JFK", "EWR", "LGA", "ORD", "SFO", "YYZ"]);
