import Link from "next/link";
import { ArrowRight, ClipboardCheck, TriangleAlert } from "lucide-react";
import { formatMoney } from "@/components/format";
import { getPolicyStore } from "@/lib/policy-store-factory";
import type { OperatorReviewItem, Policy } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function OpsPage() {
  let policies: Policy[] = [];
  let reviews: OperatorReviewItem[] = [];
  let error: string | undefined;

  try {
    const store = getPolicyStore();
    [policies, reviews] = await Promise.all([store.listPolicies(), store.getOperatorReviewQueue()]);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : "Unable to load the policy store.";
  }

  return (
    <main className="px-4 py-8 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <div className="flex items-center gap-3 border-y border-signal/40 bg-signal/5 px-3 py-2 font-mono text-[0.66rem] uppercase tracking-wider text-signal">
          <span className="border border-signal px-1.5 py-0.5">Notice</span>
          <span className="text-ink-soft">
            Operator dashboard — Stripe test mode. Live policy ledger from the durable store.
          </span>
        </div>

        <header className="bg-card p-6">
          <p className="kicker">Operator</p>
          <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">Policy ledger</h1>
          <p className="mt-2 max-w-2xl text-pretty leading-7 text-ink-soft">
            Every policy persisted by the money path. Select a policy to inspect its event timeline.
          </p>
        </header>

        {error ? (
          <div className="panel border-signal/50 p-5">
            <div className="flex items-center gap-2 text-signal">
              <TriangleAlert size={16} />
              <p className="font-mono text-[0.66rem] uppercase tracking-wider">Store unavailable</p>
            </div>
            <p className="mt-2 text-sm leading-6 text-ink-soft">{error}</p>
          </div>
        ) : (
          <>
            <section className="panel p-5">
              <p className="kicker">Open operator reviews</p>
              {reviews.length === 0 ? (
                <div className="mt-4 border-l-2 border-mint bg-paper/50 px-3 py-3">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck className="text-mint" size={16} />
                    <p className="font-mono text-[0.66rem] uppercase tracking-wider text-mint">No open operator reviews</p>
                  </div>
                </div>
              ) : (
                <ul className="mt-4 grid gap-2">
                  {reviews.map((review) => (
                    <li key={review.id} className="quiet px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className={`tag ${review.severity === "high" ? "text-signal" : "text-rain"}`}>
                          {review.reason.replaceAll("_", " ")}
                        </span>
                        <Link href={`/ops/${review.policyId}`} className="font-mono text-xs text-rain hover:underline">
                          {review.policyId}
                        </Link>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-ink-soft">{review.summary}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel p-5">
              <p className="kicker">Policies ({policies.length})</p>
              {policies.length === 0 ? (
                <p className="mt-4 text-sm leading-6 text-ink-soft">
                  No policies yet. Create one from the <Link href="/buy" className="text-rain hover:underline">/buy</Link> flow.
                </p>
              ) : (
                <div className="mt-4 grid gap-px border border-line bg-line">
                  {policies.map((policy) => (
                    <Link
                      key={policy.id}
                      href={`/ops/${policy.id}`}
                      className="group flex items-center justify-between gap-4 bg-card px-4 py-3 hover:bg-paper/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-display text-lg font-semibold">{policy.eventName}</p>
                        <p className="truncate font-mono text-xs text-ink-soft">{policy.customerName} · {policy.id}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-4">
                        <span className="tag text-mint">{policy.status.replaceAll("_", " ")}</span>
                        <span className="font-mono text-sm font-semibold">{formatMoney(policy.premium)}</span>
                        <ArrowRight className="text-ink-soft transition group-hover:text-rain" size={16} />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
