import { Activity, ArrowRight, CloudRain, Plane, ShieldCheck } from "lucide-react";

const products = [
  {
    name: "Rain event protection",
    description: "Outdoor event coverage priced from weather risk and paid when rainfall crosses a fixed trigger.",
    trigger: "Rainfall total > 5 mm",
    api: "Weather API",
    icon: CloudRain
  },
  {
    name: "Flight delay protection",
    description: "Trip coverage priced from route delay risk and paid when arrival delay crosses the covered threshold.",
    trigger: "Arrival delay > 90 min",
    api: "Flight status API",
    icon: Plane
  }
];

export default function Home() {
  return (
    <main className="min-h-screen bg-fog/90 px-4 py-8 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <div className="rounded-lg border border-amber/40 bg-amber/10 p-4 text-sm leading-6 text-slate-700">
          <strong>Hackathon demo only.</strong> PIO uses Stripe test mode and does not issue real
          insurance, coverage, or legally binding payouts.
        </div>

        <header className="rounded-lg border border-white/80 bg-white/90 p-6 shadow-panel">
          <div className="inline-flex items-center gap-2 rounded-full border border-rain/20 bg-rain/10 px-3 py-1 text-sm font-medium text-rain">
            <ShieldCheck size={16} />
            Parametric coverage issued by an AI ops agent
          </div>
          <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-normal text-ink sm:text-5xl">
            Quote, price, and issue parametric policies from one guided workflow.
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
            Customers choose a coverage type, Hermes captures the required details, the relevant risk
            API informs premium, and PIO prepares a policy packet before Stripe test-mode checkout.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              className="inline-flex items-center gap-2 rounded-lg bg-rain px-5 py-3 font-semibold text-white shadow-panel"
              href="/buy"
            >
              Start coverage quote
              <ArrowRight size={18} />
            </a>
            <a
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-3 font-semibold text-ink"
              href="/ops"
            >
              View operator dashboard
            </a>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          {products.map((product) => {
            const Icon = product.icon;
            return (
              <article key={product.name} className="rounded-lg border border-white/80 bg-white/90 p-5 shadow-panel">
                <div className="flex items-start gap-4">
                  <span className="rounded-lg bg-rain/10 p-3 text-rain">
                    <Icon size={24} />
                  </span>
                  <div>
                    <h2 className="text-xl font-semibold">{product.name}</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{product.description}</p>
                    <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold uppercase text-slate-500">
                      <span className="rounded bg-slate-100 px-2 py-1">{product.trigger}</span>
                      <span className="rounded bg-slate-100 px-2 py-1">{product.api}</span>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </section>

        <section className="rounded-lg border border-white/80 bg-white/90 p-5 shadow-panel">
          <div className="flex items-start gap-4">
            <span className="rounded-lg bg-mint/10 p-3 text-mint">
              <Activity size={24} />
            </span>
            <div>
              <p className="text-sm font-semibold uppercase text-mint">Demo flow</p>
              <h2 className="mt-1 text-2xl font-semibold">Customer quote in /buy, controls and audit in /ops</h2>
              <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-600">
                Use `/buy` to run the customer-facing quote, API telemetry, policy packet, and Stripe
                checkout path. Use `/ops` to show the operator view: state transitions, payment truth,
                weather evidence, payout controls, review queue, and audit trail.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
