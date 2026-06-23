"use client";
import { useEffect, useState } from "react";

type FeedRow = { quoteId: string; eventName: string; locationName: string; status: "pending" | "priced"; latestProgress?: string; premium?: { amount: number; currency: string }; citationCount?: number };
type Feed = { pending: FeedRow[]; recentlyPriced: FeedRow[] };

export function PricingQueue({ initial }: { initial: Feed }) {
  const [feed, setFeed] = useState<Feed>(initial);
  useEffect(() => {
    const id = setInterval(async () => {
      try { const res = await fetch("/api/ops/pricing-feed"); if (res.ok) setFeed(await res.json()); } catch { /* keep polling */ }
    }, 2000);
    return () => clearInterval(id);
  }, []);
  return (
    <section className="panel p-5">
      <p className="kicker">Pricing queue</p>
      {feed.pending.length === 0 && feed.recentlyPriced.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft">No dynamic pricing activity yet.</p>
      ) : (
        <div className="mt-4 grid gap-2">
          {feed.pending.map((r) => (
            <div key={r.quoteId} className="quiet flex items-center justify-between px-3 py-2">
              <span className="truncate">{r.eventName} · {r.locationName}</span>
              <span className="font-mono text-xs text-rain animate-pulse">{(r.latestProgress ?? "awaiting operator").replaceAll("_", " ")}</span>
            </div>
          ))}
          {feed.recentlyPriced.map((r) => (
            <div key={r.quoteId} className="quiet flex items-center justify-between px-3 py-2">
              <span className="truncate">{r.eventName} · {r.locationName}</span>
              <span className="font-mono text-xs text-mint">priced ${r.premium?.amount} · {r.citationCount ?? 0} sources</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
