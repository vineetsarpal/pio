import { createHash } from "node:crypto";
import type { Money } from "./types";

export type PioQuoteRequest = {
  customer: {
    name: string;
    email?: string;
  };
  location: {
    name: string;
    country: string;
    latitude: number;
    longitude: number;
  };
  coverageWindow: {
    start: string;
    end: string;
  };
  rainfallThresholdMm: number;
  coverageAmount: Money;
};

export type PioQuote = {
  quote_id: string;
  premium: Money;
  coverage: {
    amount: Money;
    window: PioQuoteRequest["coverageWindow"];
    location: PioQuoteRequest["location"];
    rainfallThresholdMm: number;
  };
  triggerCondition: string;
  expiresAt: string;
  riskMemo: {
    baseRate: number;
    riskMultiplier: number;
    fee: Money;
    formula: string;
    factors: string[];
  };
  auditEvent: {
    id: string;
    actor: "pio_quote_engine";
    action: "quote_generated";
    entity: {
      type: "quote";
      id: string;
    };
    timestamp: string;
    evidence: Record<string, unknown>;
  };
};

export type PioQuoteFailureCode = "invalid_dates" | "unsupported_location" | "invalid_coverage" | "expired_quote";

export class PioQuoteValidationError extends Error {
  constructor(readonly reasonCode: PioQuoteFailureCode, message: string) {
    super(message);
    this.name = "PioQuoteValidationError";
  }
}

const USD = (amount: number): Money => ({ amount, currency: "USD" });
const BASE_RATE = 0.035;
const SUPPORTED_COUNTRIES = new Set(["US", "CA"]);

export function createPioQuote(input: PioQuoteRequest, { now = new Date() }: { now?: Date } = {}): PioQuote {
  validateCoverage(input.coverageAmount);
  validateLocation(input.location);
  const window = validateWindow(input.coverageWindow, now);
  validateThreshold(input.rainfallThresholdMm);

  const riskMultiplier = calculateRiskMultiplier(input);
  const fee = calculateFee(input.coverageAmount.amount);
  const premiumAmount = Math.round(input.coverageAmount.amount * BASE_RATE * riskMultiplier + fee.amount);
  const quoteId = `qt_pio_${stableId(input)}`;
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  const triggerCondition = `Pays when observed rainfall is greater than ${input.rainfallThresholdMm} mm between ${window.start.toISOString()} and ${window.end.toISOString()} at ${input.location.name}.`;
  const factors = riskFactors(input, riskMultiplier, window.durationHours);

  return {
    quote_id: quoteId,
    premium: USD(premiumAmount),
    coverage: {
      amount: input.coverageAmount,
      window: {
        start: window.start.toISOString(),
        end: window.end.toISOString()
      },
      location: {
        ...input.location,
        country: input.location.country.toUpperCase()
      },
      rainfallThresholdMm: input.rainfallThresholdMm
    },
    triggerCondition,
    expiresAt,
    riskMemo: {
      baseRate: BASE_RATE,
      riskMultiplier,
      fee,
      formula: "premium = round(coverage_amount * base_rate * risk_multiplier + fee)",
      factors
    },
    auditEvent: {
      id: `aud_${quoteId}`,
      actor: "pio_quote_engine",
      action: "quote_generated",
      entity: { type: "quote", id: quoteId },
      timestamp: now.toISOString(),
      evidence: {
        coverageAmount: input.coverageAmount.amount,
        premiumAmount,
        baseRate: BASE_RATE,
        riskMultiplier,
        feeAmount: fee.amount,
        triggerThresholdMm: input.rainfallThresholdMm,
        location: input.location.name
      }
    }
  };
}

function validateCoverage(coverageAmount: Money): void {
  if (coverageAmount.currency !== "USD") {
    throw new PioQuoteValidationError("invalid_coverage", "PIO demo quotes currently support USD coverage only.");
  }
  if (!Number.isFinite(coverageAmount.amount) || coverageAmount.amount < 100 || coverageAmount.amount > 50_000) {
    throw new PioQuoteValidationError("invalid_coverage", "coverageAmount.amount must be between 100 and 50000.");
  }
}

function validateLocation(location: PioQuoteRequest["location"]): void {
  if (!SUPPORTED_COUNTRIES.has(location.country.toUpperCase())) {
    throw new PioQuoteValidationError("unsupported_location", "PIO rain protection is currently supported only for US and CA demo locations.");
  }
  if (!Number.isFinite(location.latitude) || location.latitude < -90 || location.latitude > 90) {
    throw new PioQuoteValidationError("unsupported_location", "location.latitude must be a valid coordinate.");
  }
  if (!Number.isFinite(location.longitude) || location.longitude < -180 || location.longitude > 180) {
    throw new PioQuoteValidationError("unsupported_location", "location.longitude must be a valid coordinate.");
  }
}

function validateWindow(coverageWindow: PioQuoteRequest["coverageWindow"], now: Date) {
  const start = new Date(coverageWindow.start);
  const end = new Date(coverageWindow.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new PioQuoteValidationError("invalid_dates", "coverageWindow.start and coverageWindow.end must be valid ISO dates with end after start.");
  }
  if (end <= now) {
    throw new PioQuoteValidationError("expired_quote", "coverageWindow.end is in the past; create a quote for a future coverage window.");
  }
  const durationHours = (end.getTime() - start.getTime()) / (60 * 60 * 1000);
  if (durationHours > 168) {
    throw new PioQuoteValidationError("invalid_dates", "coverage windows longer than 7 days are not supported in the demo quote engine.");
  }
  return { start, end, durationHours };
}

function validateThreshold(thresholdMm: number): void {
  if (!Number.isFinite(thresholdMm) || thresholdMm < 1 || thresholdMm > 100) {
    throw new PioQuoteValidationError("invalid_coverage", "rainfallThresholdMm must be between 1 and 100.");
  }
}

function calculateFee(coverageAmount: number): Money {
  return USD(Math.round(coverageAmount * 0.03 + 14));
}

function calculateRiskMultiplier(input: PioQuoteRequest): number {
  const coastalOrGreatLakes = /waterfront|harbor|pier|coast|beach|lake/i.test(input.location.name) ? 0.35 : 0.1;
  const latitudeBand = Math.abs(input.location.latitude) >= 40 ? 0.25 : 0.1;
  const thresholdAdjustment = input.rainfallThresholdMm <= 5 ? 0.45 : input.rainfallThresholdMm <= 10 ? 0.25 : 0.05;
  const coverageAdjustment = input.coverageAmount.amount >= 5000 ? 0.2 : input.coverageAmount.amount >= 1000 ? 0.15 : 0.05;
  return round2(1.2 + coastalOrGreatLakes + latitudeBand + thresholdAdjustment + coverageAdjustment);
}

function riskFactors(input: PioQuoteRequest, riskMultiplier: number, durationHours: number): string[] {
  return [
    `${input.location.country.toUpperCase()} demo location accepted for rain protection`,
    `${durationHours.toFixed(1)} hour coverage window`,
    `${input.rainfallThresholdMm} mm rainfall trigger`,
    `Deterministic risk multiplier ${riskMultiplier}`
  ];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function stableId(input: PioQuoteRequest): string {
  const canonical = JSON.stringify({
    customer: input.customer.name.trim().toLowerCase(),
    location: [input.location.name.trim().toLowerCase(), input.location.country.toUpperCase(), input.location.latitude, input.location.longitude],
    coverageWindow: input.coverageWindow,
    rainfallThresholdMm: input.rainfallThresholdMm,
    coverageAmount: input.coverageAmount
  });
  const digest = createHash("sha256").update(canonical).digest("hex").slice(0, 10);
  return Number.parseInt(digest, 16).toString(36).padStart(7, "0").slice(0, 7);
}
