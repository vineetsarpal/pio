export default async function BuySuccessPage({
  searchParams
}: {
  searchParams: Promise<{ session_id?: string; policy_id?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="min-h-screen bg-fog/90 px-4 py-8 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl rounded-lg border border-white/80 bg-white/90 p-6 shadow-panel">
        <p className="text-sm font-semibold uppercase text-mint">Stripe test checkout returned</p>
        <h1 className="mt-2 text-4xl font-semibold">Premium payment ready for verification</h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          In a production integration, Stripe's checkout.session.completed webhook posts the immutable
          premium_collected event before PIO issues the policy. This hackathon page keeps the boundary
          explicit so the agent cannot activate coverage from a redirect alone.
        </p>
        <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-3">
            <dt className="font-medium text-slate-500">Checkout session</dt>
            <dd className="mt-1 break-all font-semibold">{params.session_id ?? "missing"}</dd>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <dt className="font-medium text-slate-500">Policy</dt>
            <dd className="mt-1 break-all font-semibold">{params.policy_id ?? "missing"}</dd>
          </div>
        </dl>
        <a className="mt-6 inline-block rounded-lg bg-rain px-5 py-3 font-semibold text-white" href="/">
          Back to operator dashboard
        </a>
      </div>
    </main>
  );
}
