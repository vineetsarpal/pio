import { Activity, ArrowRight, CloudRain, Plane, ShieldCheck } from "lucide-react";

const products = [
  {
    name: "Rain event protection",
    description:
      "Outdoor event coverage priced from weather risk and paid when rainfall crosses a fixed trigger.",
    trigger: "Rainfall total > 5 mm",
    api: "Weather API",
    icon: CloudRain
  },
  {
    name: "Flight delay protection",
    description:
      "Trip coverage priced from route delay risk and paid when arrival delay crosses the covered threshold.",
    trigger: "Arrival delay > 90 min",
    api: "Flight status API",
    icon: Plane
  }
];

const ledger = [
  ["01", "Quote", "Choose a coverage type and get an instant price from live risk data."],
  ["02", "Pay", "Pay the premium securely by card; your policy activates once payment clears."],
  ["03", "Monitor", "We track the live data feed against your policy's trigger for you."],
  ["04", "Payout", "If the trigger is met, your payout is sent automatically — no claims to file."]
];

export default function Home() {
  return (
    <main className="px-4 py-10 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-10">
        {/* Caution dateline */}
        <div
          className="flex animate-rise items-center gap-3 border-y border-signal/40 bg-signal/5 px-3 py-2 font-mono text-[0.66rem] uppercase tracking-wider text-signal"
          style={{ animationDelay: "40ms" }}
        >
          <span className="border border-signal px-1.5 py-0.5">Notice</span>
          <span className="text-ink-soft">
            Hackathon demo only — Stripe test mode. No real insurance, coverage, or legally binding
            payouts are issued.
          </span>
        </div>

        {/* Lead / front page */}
        <header className="grid gap-8 lg:grid-cols-[1.35fr_0.65fr] lg:items-end">
          <div>
            <div
              className="mb-5 inline-flex animate-rise items-center gap-2 border border-rain bg-rain/10 px-3 py-1 font-mono text-[0.68rem] uppercase tracking-kicker text-rain"
              style={{ animationDelay: "80ms" }}
            >
              <ShieldCheck size={13} />
              Coverage issued by an AI operations agent
            </div>
            <h1
              className="max-w-4xl animate-rise text-balance font-display text-5xl font-semibold leading-[0.98] tracking-tight sm:text-6xl lg:text-[4.7rem]"
              style={{ animationDelay: "140ms" }}
            >
              Quote, price &amp; issue parametric policies from one{" "}
              <span className="italic text-rain">guided workflow.</span>
            </h1>
            <p
              className="mt-6 max-w-2xl animate-rise text-pretty text-lg leading-8 text-ink-soft"
              style={{ animationDelay: "220ms" }}
            >
              A customer chooses a coverage type, the agent captures only the required details, the
              relevant risk API informs premium, and PIO prepares a policy packet before Stripe
              test-mode checkout.
            </p>
            <div
              className="mt-8 flex animate-rise flex-wrap gap-3"
              style={{ animationDelay: "300ms" }}
            >
              <a className="btn shadow-riso" href="/buy">
                Start coverage quote
                <ArrowRight size={16} />
              </a>
              <a className="btn-ghost" href="/ops">
                View operator dashboard
              </a>
            </div>
          </div>

          {/* Specimen card */}
          <aside
            className="reg animate-rise self-stretch border border-ink bg-card p-5 shadow-riso"
            style={{ animationDelay: "360ms" }}
          >
            <div className="flex items-center justify-between border-b border-line pb-3">
              <span className="kicker">Specimen Certificate</span>
              <span className="tag text-mint">Issued</span>
            </div>
            <dl className="mt-4 space-y-3 font-mono text-sm">
              <SpecRow label="Certificate" value="PIO-RAIN-0001" />
              <SpecRow label="Premium" value="$25.00" />
              <SpecRow label="Fixed payout" value="$500.00" />
              <SpecRow label="Trigger" value="rainfall > 5mm" />
            </dl>
            <div className="mt-4 flex items-center gap-3 border border-mint/40 bg-mint/10 px-3 py-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-mint text-mint">
                <ShieldCheck size={16} />
              </span>
              <p className="font-mono text-[0.66rem] uppercase leading-snug tracking-wider text-mint">
                Activated only after event-verified premium
              </p>
            </div>
          </aside>
        </header>

        {/* Coverage catalog */}
        <section>
          <div className="mb-4 flex items-end justify-between border-b border-ink pb-2">
            <h2 className="font-display text-2xl font-semibold">Coverage catalog</h2>
            <span className="kicker">Two parametric lines</span>
          </div>
          <div className="grid gap-px border border-line bg-line md:grid-cols-2">
            {products.map((product) => {
              const Icon = product.icon;
              return (
                <article key={product.name} className="group bg-card p-6 transition-colors hover:bg-paper/60">
                  <div className="flex items-start justify-between">
                    <span className="flex h-12 w-12 items-center justify-center border border-ink bg-rain/10 text-rain transition-transform group-hover:-translate-y-0.5">
                      <Icon size={22} />
                    </span>
                  </div>
                  <h3 className="mt-5 font-display text-2xl font-semibold">{product.name}</h3>
                  <p className="mt-2 max-w-md text-pretty leading-7 text-ink-soft">
                    {product.description}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <span className="tag text-rain">{product.trigger}</span>
                    <span className="tag text-ink-soft">{product.api}</span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* Demo flow ledger */}
        <section className="reg border border-ink bg-card p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center border border-mint bg-mint/10 text-mint">
              <Activity size={22} />
            </span>
            <div>
              <p className="kicker text-mint">How it works</p>
              <h2 className="mt-1 max-w-3xl font-display text-3xl font-semibold leading-tight">
                Get covered in minutes, <span className="text-rain">paid out automatically.</span>
              </h2>
            </div>
          </div>
          <ol className="mt-7 grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            {ledger.map(([n, title, body]) => (
              <li key={n} className="bg-card p-4">
                <span className="font-display text-3xl font-semibold text-rain">{n}</span>
                <p className="mt-2 font-mono text-[0.7rem] uppercase tracking-wider">{title}</p>
                <p className="mt-1 text-sm leading-6 text-ink-soft">{body}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[0.66rem] uppercase tracking-wider text-ink-soft">{label}</dt>
      <dd className="flex-1 border-b border-dotted border-line" />
      <dd className="font-semibold text-ink">{value}</dd>
    </div>
  );
}
