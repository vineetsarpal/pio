import type { PricingJob, ProgressEvent } from "./pricing-job";
import type { Citation } from "./coverage-products";
import type { Money } from "./types";

export type QuoteStatusView = {
  found: boolean;
  status: "quote_requested" | "policy_quoted";
  baseline?: PricingJob["baseline"];
  premium?: Money;
  citations?: Citation[];
  pricedBy?: PricingJob["pricedBy"];
  progress: ProgressEvent[];
};

export function quoteStatusView(job: PricingJob | undefined): QuoteStatusView {
  if (!job) return { found: false, status: "quote_requested", progress: [] };
  return {
    found: true,
    status: job.status === "priced" ? "policy_quoted" : "quote_requested",
    baseline: job.baseline,
    premium: job.premium,
    citations: job.citations,
    pricedBy: job.pricedBy,
    progress: job.progress ?? []
  };
}

export type FeedRow = {
  quoteId: string; eventName: string; locationName: string;
  window: { start: string; end: string }; status: PricingJob["status"];
  latestProgress?: string; premium?: Money; citationCount?: number; createdAt: string;
};

function row(job: PricingJob): FeedRow {
  const p = job.productInput as { eventName?: string; locationName?: string; eventStart?: string; eventEnd?: string; departureTime?: string; arrivalTime?: string };
  const last = job.progress?.[job.progress.length - 1];
  return {
    quoteId: job.quoteId,
    eventName: p.eventName ?? job.quoteId,
    locationName: p.locationName ?? "",
    window: { start: p.eventStart ?? p.departureTime ?? "", end: p.eventEnd ?? p.arrivalTime ?? "" },
    status: job.status,
    latestProgress: last?.step,
    premium: job.premium,
    citationCount: job.citations?.length,
    createdAt: job.createdAt
  };
}

export function pricingFeedView(jobs: PricingJob[]): { pending: FeedRow[]; recentlyPriced: FeedRow[] } {
  return {
    pending: jobs.filter((j) => j.status === "pending").map(row),
    recentlyPriced: jobs.filter((j) => j.status === "priced").map(row)
  };
}
