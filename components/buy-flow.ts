import type { Citation } from "@/lib/coverage-products";
import type { ProgressEvent } from "@/lib/pricing-job";
import type { QuoteStatusView } from "@/lib/ops-feed";
import type { Money } from "@/lib/types";

export type Baseline = { premium: Money };
export type DynamicQuoteState =
  | { phase: "idle" }
  | { phase: "intake"; quoteId: string; baseline?: Baseline; progress: ProgressEvent[] }
  | { phase: "priced"; quoteId: string; premium: Money; citations: Citation[]; progress: ProgressEvent[] }
  | { phase: "error"; message: string };

export type DynamicQuoteAction =
  | { type: "requested"; quoteId: string; baseline?: Baseline }
  | { type: "statusPolled"; status: QuoteStatusView }
  | { type: "failed"; message: string }
  | { type: "reset" };

export function dynamicQuoteReducer(state: DynamicQuoteState, action: DynamicQuoteAction): DynamicQuoteState {
  switch (action.type) {
    case "reset":
      return { phase: "idle" };
    case "requested":
      return { phase: "intake", quoteId: action.quoteId, baseline: action.baseline, progress: [] };
    case "failed":
      return { phase: "error", message: action.message };
    case "statusPolled": {
      if (state.phase !== "intake") return state;
      const v = action.status;
      if (v.found && v.status === "policy_quoted" && v.premium) {
        return { phase: "priced", quoteId: state.quoteId, premium: v.premium, citations: v.citations ?? [], progress: v.progress };
      }
      return { ...state, progress: v.progress, baseline: v.baseline ? { premium: v.baseline.premium } : state.baseline };
    }
  }
}
