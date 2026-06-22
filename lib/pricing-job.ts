import type { ProductQuoteInput } from "./coverage-products";

export type PricingJob = {
  quoteId: string;
  productInput: ProductQuoteInput;
  status: "pending" | "priced";
  createdAt: string;
  pricedAt?: string;
};
