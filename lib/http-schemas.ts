import { z } from "zod";

/**
 * Structural validation for untrusted HTTP request bodies. These schemas guard
 * the shape only — required fields, primitive types, the USD currency literal,
 * the productId discriminant. Business rules (coverage min/max, date windows,
 * premium caps) stay in the domain layer (`coverage-products`, `workflow`,
 * `agent-coverage`) so a structurally valid body still flows through to its
 * granular domain reason code (e.g. `invalid_coverage`). The point is that a
 * malformed or missing field becomes a clean 400 instead of an unchecked `as`
 * cast that surfaces later as `undefined` in a persisted policy.
 */

export const moneySchema = z.object({
  amount: z.number(),
  currency: z.literal("USD")
});

export const coverageRequestSchema = z.object({
  customerName: z.string().min(1),
  eventName: z.string().min(1),
  locationName: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  eventStart: z.string().min(1),
  eventEnd: z.string().min(1),
  desiredPayout: moneySchema,
  maximumPremium: moneySchema.optional()
});

const rainEventQuoteInputSchema = z.object({
  productId: z.literal("rain_event"),
  customerName: z.string().min(1),
  eventName: z.string().min(1),
  locationName: z.string().min(1),
  latitude: z.number(),
  longitude: z.number(),
  eventStart: z.string().min(1),
  eventEnd: z.string().min(1),
  desiredPayout: moneySchema,
  deductible: moneySchema.optional(),
  maximumPremium: moneySchema.optional()
});

const flightDelayQuoteInputSchema = z.object({
  productId: z.literal("flight_delay"),
  customerName: z.string().min(1),
  passengerName: z.string().min(1),
  airline: z.string().min(1),
  flightNumber: z.string().min(1),
  originAirport: z.string().min(1),
  destinationAirport: z.string().min(1),
  departureTime: z.string().min(1),
  arrivalTime: z.string().min(1),
  desiredPayout: moneySchema,
  deductible: moneySchema.optional(),
  maximumPremium: moneySchema.optional()
});

export const productQuoteInputSchema = z.discriminatedUnion("productId", [
  rainEventQuoteInputSchema,
  flightDelayQuoteInputSchema
]);

/**
 * create-checkout accepts either a product-aware quote input or a bare coverage
 * request. Product schemas come first so a payload carrying a `productId` keeps
 * it (a bare coverage request lacks the discriminant and falls through).
 */
export const checkoutRequestSchema = z.union([productQuoteInputSchema, coverageRequestSchema]);

export const dynamicCoverageRequestSchema = z.intersection(
  productQuoteInputSchema,
  z.object({ pricing: z.literal("dynamic") })
);

export const agentOffSessionPurchaseBodySchema = z.object({
  idempotencyKey: z.string().min(1),
  coverageRequest: coverageRequestSchema
});

const coordinate = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .refine((value) => {
      const n = Number(value);
      return Number.isFinite(n) && n >= min && n <= max;
    }, `must be a number between ${min} and ${max}`)
    .transform((value) => Number(value));

/**
 * Reverse-geocode query params. Coerces the raw `lat`/`lon` strings to numbers
 * and bounds them to valid coordinate ranges so a missing, non-numeric, or
 * out-of-range value is rejected before it reaches the upstream Nominatim URL.
 */
export const reverseGeocodeQuerySchema = z.object({
  lat: coordinate(-90, 90),
  lon: coordinate(-180, 180)
});

export type JsonBodyResult<T> = { ok: true; data: T } | { ok: false; message: string };

/**
 * Parse and validate an untrusted JSON request body against a schema. Returns
 * the typed value on success, or a single human-readable message on failure
 * (malformed JSON or a schema violation) that each route maps into its own
 * response envelope and reason code.
 */
export async function parseJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S
): Promise<JsonBodyResult<z.infer<S>>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, message: "Request body must be valid JSON." };
  }

  const result = schema.safeParse(raw);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, message: formatIssues(result.error) };
}

/**
 * Parse and validate URL query parameters against a schema. Unknown params are
 * ignored (object schemas strip them); missing required params fail validation.
 */
export function parseQuery<S extends z.ZodType>(url: string, schema: S): JsonBodyResult<z.infer<S>> {
  const params = new URL(url).searchParams;
  const result = schema.safeParse(Object.fromEntries(params));
  if (result.success) {
    return { ok: true, data: result.data };
  }
  return { ok: false, message: formatIssues(result.error) };
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}
