import { CheckCircle2 } from "lucide-react";

export default async function BuySuccessPage({
  searchParams
}: {
  searchParams: Promise<{ session_id?: string; policy_id?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="px-4 py-14 text-ink sm:px-6 lg:px-8">
      <div className="reg mx-auto max-w-3xl animate-rise border border-ink bg-card p-7 shadow-riso sm:p-9">
        <div className="flex items-center justify-between border-b border-line pb-4">
          <p className="kicker text-mint">Stripe test checkout returned</p>
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-mint text-mint">
            <CheckCircle2 size={18} />
          </span>
        </div>
        <h1 className="mt-5 text-balance font-display text-4xl font-semibold leading-tight sm:text-5xl">
          Premium payment ready for verification
        </h1>
        <p className="mt-5 text-pretty leading-8 text-ink-soft">
          In a production integration, Stripe&apos;s <code className="font-mono text-rain">checkout.session.completed</code>{" "}
          webhook posts the immutable <code className="font-mono text-rain">premium_collected</code> event before PIO
          issues the policy. This hackathon page keeps the boundary explicit so the agent cannot
          activate coverage from a redirect alone.
        </p>
        <dl className="mt-7 grid gap-px border border-line bg-line sm:grid-cols-2">
          <div className="bg-card p-4">
            <dt className="font-mono text-[0.62rem] uppercase tracking-wider text-ink-soft">Checkout session</dt>
            <dd className="mt-1.5 break-all font-mono text-sm font-semibold">{params.session_id ?? "missing"}</dd>
          </div>
          <div className="bg-card p-4">
            <dt className="font-mono text-[0.62rem] uppercase tracking-wider text-ink-soft">Policy</dt>
            <dd className="mt-1.5 break-all font-mono text-sm font-semibold">{params.policy_id ?? "missing"}</dd>
          </div>
        </dl>
        <div className="mt-7 flex flex-wrap gap-3">
          <a className="btn" href="/buy">
            Back to quote workspace
          </a>
          <a className="btn-ghost" href="/ops">
            View operator dashboard
          </a>
        </div>
      </div>
    </main>
  );
}
