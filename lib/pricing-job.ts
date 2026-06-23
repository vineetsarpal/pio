import type { Citation, ProductQuoteInput, RiskAssessment } from "./coverage-products";
import type { Money } from "./types";

export type ProgressEvent = { at: string; source: "pio" | "operator"; step: string; detail?: string };

export type PricingJob = {
  quoteId: string;
  productInput: ProductQuoteInput;
  status: "pending" | "priced";
  createdAt: string;
  pricedAt?: string;
  baseline?: { risk: RiskAssessment; premium: Money };
  progress?: ProgressEvent[];
  premium?: Money;
  citations?: Citation[];
  pricedBy?: "operator_research" | "deterministic_fallback";
};

export function withProgress(job: PricingJob, event: ProgressEvent): PricingJob {
  return { ...job, progress: [...(job.progress ?? []), event] };
}
