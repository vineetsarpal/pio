import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CloudRain, FileCheck2, Gavel } from "lucide-react";
import { formatDateTime, formatMoney } from "@/components/format";
import { buildPolicyTimeline, findAuditReport, findTriggerDecision, findWeatherEvidence } from "@/lib/ops-view";
import { getPolicyStore } from "@/lib/policy-store-factory";

export const dynamic = "force-dynamic";

export default async function PolicyDetailPage({ params }: { params: Promise<{ policyId: string }> }) {
  const { policyId } = await params;
  const ledger = await getPolicyStore().snapshotForPolicy(policyId);
  const policy = ledger.policies[0];
  if (!policy) {
    notFound();
  }

  const timeline = buildPolicyTimeline(ledger);
  const weather = findWeatherEvidence(ledger);
  const decision = findTriggerDecision(ledger);
  const audit = findAuditReport(ledger);

  const stageCards = [
    { label: "Premium", value: formatMoney(policy.premium) },
    { label: "Fixed payout", value: formatMoney(policy.payout) },
    { label: "Trigger", value: `${policy.trigger.aggregation} ${policy.trigger.variable.replaceAll("_", " ")} > ${policy.trigger.threshold}` },
    { label: "Status", value: policy.status.replaceAll("_", " ") }
  ];

  return (
    <main className="px-4 py-8 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <Link href="/ops" className="inline-flex items-center gap-2 font-mono text-xs text-rain hover:underline">
          <ArrowLeft size={14} /> Back to ledger
        </Link>

        <header className="bg-card p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="kicker">{policy.customerName}</p>
              <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">{policy.eventName}</h1>
              <p className="mt-1 font-mono text-xs text-ink-soft">{policy.id}</p>
            </div>
            <span className="tag text-mint">{policy.status.replaceAll("_", " ")}</span>
          </div>
          <div className="mt-5 grid gap-px border border-line bg-line sm:grid-cols-4">
            {stageCards.map((card) => (
              <div key={card.label} className="bg-card p-4">
                <p className="kicker">{card.label}</p>
                <p className="mt-1 font-display text-xl font-semibold">{card.value}</p>
              </div>
            ))}
          </div>
        </header>

        <section className="panel p-5">
          <p className="kicker">Event timeline</p>
          <ul className="mt-4 grid gap-px border border-line bg-line">
            {timeline.map((item) => (
              <li key={item.key} className="bg-card px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[0.66rem] uppercase tracking-wider text-rain">
                    {item.kind.replaceAll("_", " ")}
                  </span>
                  <span className="font-mono text-xs text-ink-soft">{formatDateTime(item.at)}</span>
                </div>
                <p className="mt-1 text-sm leading-6 text-ink-soft">{item.summary}</p>
                {item.actor ? <p className="mt-1 font-mono text-[0.62rem] text-ink-soft/70">{item.actor}</p> : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="panel p-5">
          <div className="flex items-center gap-2">
            <CloudRain className="text-rain" size={16} />
            <p className="kicker">Weather evidence</p>
          </div>
          {weather ? (
            <p className="mt-3 text-sm leading-6 text-ink-soft">
              {weather.observations.length} observations from {weather.source.replaceAll("_", " ")} · snapshot {weather.metadata.snapshotId}
            </p>
          ) : (
            <p className="mt-3 text-sm leading-6 text-ink-soft/70">Awaiting data — no weather observations recorded yet.</p>
          )}
        </section>

        <section className="panel p-5">
          <div className="flex items-center gap-2">
            <Gavel className="text-rain" size={16} />
            <p className="kicker">Trigger decision</p>
          </div>
          {decision ? (
            <p className={`mt-3 text-sm leading-6 ${decision.approved ? "text-mint" : "text-ink-soft"}`}>
              {decision.reason} ({decision.rainfallTotalMm} mm vs {decision.thresholdMm} mm)
            </p>
          ) : (
            <p className="mt-3 text-sm leading-6 text-ink-soft/70">Awaiting data — trigger not yet evaluated.</p>
          )}
        </section>

        <section className="panel p-5">
          <div className="flex items-center gap-2">
            <FileCheck2 className="text-rain" size={16} />
            <p className="kicker">Audit report</p>
          </div>
          {audit ? (
            <p className="mt-3 text-sm leading-6 text-ink-soft">{audit.summary}</p>
          ) : (
            <p className="mt-3 text-sm leading-6 text-ink-soft/70">Awaiting data — no audit report generated yet.</p>
          )}
        </section>
      </div>
    </main>
  );
}
