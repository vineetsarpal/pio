import {
  BadgeCheck,
  Banknote,
  Bot,
  CalendarClock,
  CloudRain,
  Code2,
  ClipboardCheck,
  FileCheck2,
  MapPin,
  ShieldCheck,
  TriangleAlert,
  Waves
} from "lucide-react";
import { formatDateTime, formatMoney } from "@/components/format";
import { demoRun } from "@/lib/demo-data";
import { getAllowedTransitions } from "@/lib/state-machine";

const stateRows = [
  "policy_quoted",
  "premium_paid",
  "policy_issued",
  "monitoring_active",
  "trigger_data_received",
  "trigger_evaluated",
  "claim_approved"
] as const;

const stageCards = [
  { label: "Quote", value: "$25", description: "Premium locked by deterministic pricing", icon: BadgeCheck },
  { label: "Policy", value: "$500", description: "Fixed payout for covered rainfall", icon: ShieldCheck },
  { label: "Trigger", value: "> 5 mm", description: "Rainfall sum during the event window", icon: CloudRain },
  { label: "Payout", value: "Paid", description: "Stripe test-mode payout after approval", icon: Banknote }
];

export default function Home() {
  const { policy, evidence, decision, actions, audit, auditTrail, operatorReviewQueue, ledgerConsistency, ledger } = demoRun;
  const maxRainfall = Math.max(...evidence.observations.map((observation) => observation.rainfallMm ?? 0));
  const finalAuditSnapshot = ledger.auditSnapshots.find((snapshot) => snapshot.report.id === audit.id);
  const policyConsistency = ledgerConsistency.checks.find((check) => check.policyId === policy.id);

  return (
    <main className="min-h-screen bg-fog/90 px-4 py-5 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="grid gap-5 rounded-lg border border-white/70 bg-white/90 p-5 shadow-panel backdrop-blur md:grid-cols-[1.15fr_0.85fr]">
          <section className="flex flex-col justify-between gap-6">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-rain/20 bg-rain/10 px-3 py-1 text-sm font-medium text-rain">
                <Bot size={16} />
                Gauge operating in demo mode
              </div>
              <h1 className="max-w-3xl text-4xl font-semibold tracking-normal text-ink sm:text-5xl">
                PIO runs automatic rain cover from quote to claim.
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
                A simulated parametric policy for outdoor markets: Stripe test-mode premium collection,
                seeded weather replay, deterministic trigger evaluation, and an audit trail generated from
                the evidence.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric icon={MapPin} label="Location" value={policy.locationName} />
              <Metric icon={CalendarClock} label="Window" value="12 PM - 6 PM" />
              <Metric icon={FileCheck2} label="Certificate" value={policy.certificateId} />
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium uppercase text-slate-500">Simulated policy</p>
                <h2 className="mt-1 text-2xl font-semibold">{policy.eventName}</h2>
              </div>
              <span className="rounded-full bg-mint/10 px-3 py-1 text-sm font-semibold text-mint">
                {policy.status.replaceAll("_", " ")}
              </span>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <PolicyFact label="Customer" value={policy.customerName} />
              <PolicyFact label="Oracle" value={evidence.source.replaceAll("_", " ")} />
              <PolicyFact label="Premium" value={formatMoney(policy.premium)} />
              <PolicyFact label="Fixed payout" value={formatMoney(policy.payout)} />
              <PolicyFact label="Event starts" value={formatDateTime(policy.trigger.window.start)} />
              <PolicyFact label="Event ends" value={formatDateTime(policy.trigger.window.end)} />
            </dl>
          </section>
        </header>

        <section className="grid gap-4 md:grid-cols-4">
          {stageCards.map((card) => (
            <div key={card.label} className="rounded-lg border border-white/80 bg-white/90 p-4 shadow-panel">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-500">{card.label}</p>
                  <p className="mt-1 text-2xl font-semibold">{card.value}</p>
                </div>
                <card.icon className="text-rain" size={22} />
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">{card.description}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="rounded-lg border border-white/80 bg-white/90 p-5 shadow-panel">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium uppercase text-slate-500">Monitoring</p>
                <h2 className="mt-1 text-2xl font-semibold">Rainfall timeline</h2>
              </div>
              <div className="flex items-center gap-2 rounded-full bg-amber/10 px-3 py-1 text-sm font-semibold text-amber">
                <Waves size={16} />
                {decision.rainfallTotalMm.toFixed(1)} mm total
              </div>
            </div>
            <div className="mt-6 flex h-56 items-end gap-2 border-b border-slate-200 pb-2">
              {evidence.observations.map((observation) => {
                const inWindow =
                  new Date(observation.observedAt) >= new Date(policy.trigger.window.start) &&
                  new Date(observation.observedAt) <= new Date(policy.trigger.window.end);
                return (
                  <div key={observation.observedAt} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                    <div
                      className={`w-full rounded-t ${inWindow ? "bg-rain" : "bg-slate-300"}`}
                      style={{
                        height: `${Math.max(8, (((observation.rainfallMm ?? 0) / maxRainfall) * 180) || 8)}px`
                      }}
                      title={observation.rainfallMm === null ? "missing" : `${observation.rainfallMm} mm`}
                    />
                    <span className="text-xs text-slate-500">
                      {new Date(observation.observedAt).getHours()}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 rounded-lg border border-mint/25 bg-mint/10 p-4">
              <p className="text-sm font-semibold text-mint">Claim approved</p>
              <p className="mt-1 text-sm leading-6 text-slate-700">{decision.reason}</p>
            </div>
          </div>

          <div className="rounded-lg border border-white/80 bg-white/90 p-5 shadow-panel">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium uppercase text-slate-500">Gauge action log</p>
                <h2 className="mt-1 text-2xl font-semibold">Agent-operated workflow</h2>
              </div>
              <Bot className="text-rain" size={24} />
            </div>
            <div className="mt-5 divide-y divide-slate-200">
              {actions.map((action) => (
                <article key={action.id} className="grid gap-3 py-3 sm:grid-cols-[9rem_1fr]">
                  <div>
                    <p className="text-sm font-semibold text-slate-700">{action.actor}</p>
                    <p className="mt-1 text-xs text-slate-500">{formatDateTime(action.at)}</p>
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{action.action}</h3>
                      <span className={statusClass(action.status)}>{action.status}</span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{action.detail}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-3">
          <AuditPanel
            title="Policy terms"
            body={`Demo policy ${policy.id} pays ${formatMoney(policy.payout)} if rainfall exceeds ${policy.trigger.threshold} mm between ${formatDateTime(policy.trigger.window.start)} and ${formatDateTime(policy.trigger.window.end)}.`}
          />
          <AuditPanel
            title="Payment controls"
            body={`Premium collection is recorded as an immutable payment event before issue. Payout reference ${policy.stripePayoutReference} is only created after deterministic approval.`}
          />
          <AuditPanel
            title="Audit stance"
            body="Gauge can explain and operate the workflow, but trigger approval, activation, payout amount, and duplicate-payout blocking live in deterministic code."
          />
        </section>

        <section className="rounded-lg border border-white/80 bg-white/90 p-5 shadow-panel">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-medium uppercase text-slate-500">Agent buyer path</p>
              <h2 className="mt-1 text-2xl font-semibold">Customer-owned agents can request coverage</h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                `POST /api/agent/coverage-request` returns a quote or a machine-readable rejection.
                `POST /api/agent/confirm-purchase` then creates checkout only with explicit authorization
                and an idempotency key.
              </p>
            </div>
            <Code2 className="shrink-0 text-rain" size={24} />
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <PolicyFact label="Intent" value="buy_if_within_budget" />
            <PolicyFact label="Budget cap" value="$75" />
            <PolicyFact label="Guardrail" value="confirm + idempotency" />
          </div>
        </section>

        <section className="rounded-lg border border-white/80 bg-white/90 p-5 shadow-panel">
          <p className="text-sm font-medium uppercase text-slate-500">Payment truth</p>
          <h2 className="mt-1 text-2xl font-semibold">Premium completion is event-driven</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <PolicyFact label="Webhook" value="/api/stripe/premium-collected" />
            <PolicyFact label="Event" value="premium_collected" />
            <PolicyFact label="Activation" value="premium_paid state" />
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-600">
            Gauge can request checkout and narrate verification, but policy issuance depends on the
            `premium_collected` event tied to the checkout id.
          </p>
        </section>

        <section className="rounded-lg border border-white/80 bg-white/90 p-5 shadow-panel">
          <p className="text-sm font-medium uppercase text-slate-500">Payout truth</p>
          <h2 className="mt-1 text-2xl font-semibold">Approval and payout completion are separate</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <PolicyFact label="Request event" value="payout_requested" />
            <PolicyFact label="Success event" value="payout_issued" />
            <PolicyFact label="Failure event" value="payout_failed" />
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-600">
            Deterministic settlement approves the claim and requests payout. Stripe Skills then report
            payout completion or failure without changing the trigger decision.
          </p>
        </section>

        <section className="rounded-lg border border-white/80 bg-white/90 p-5 shadow-panel">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-medium uppercase text-slate-500">Operator review</p>
              <h2 className="mt-1 text-2xl font-semibold">Human queue for controlled exceptions</h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                PIO keeps clean claims automatic while routing advisory weather evidence and failed payout
                events to an operator-owned lane.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full bg-amber/10 px-3 py-1 text-sm font-semibold text-amber">
              <TriangleAlert size={16} />
              {operatorReviewQueue.length} open
            </div>
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-[0.85fr_1.15fr]">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <PolicyFact label="Manual weather" value="manual_review" />
              <PolicyFact label="Payment exception" value="payout_failed" />
            </div>
            <div className="grid gap-2">
              {operatorReviewQueue.length > 0 ? (
                operatorReviewQueue.map((item) => (
                  <article key={item.id} className="rounded-lg bg-fog px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{item.title}</p>
                      <span className={reviewSeverityClass(item.severity)}>{item.severity}</span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{item.summary}</p>
                    <p className="mt-2 text-xs font-medium uppercase text-slate-500">{item.nextAction}</p>
                  </article>
                ))
              ) : (
                <div className="rounded-lg bg-fog px-3 py-3">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck className="text-mint" size={18} />
                    <p className="text-sm font-semibold">No open operator reviews</p>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    The demo claim used settlement-grade weather evidence and completed the Stripe test-mode payout.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-lg border border-white/80 bg-white/90 p-5 shadow-panel">
            <p className="text-sm font-medium uppercase text-slate-500">Oracle evidence</p>
            <h2 className="mt-1 text-2xl font-semibold">
              {evidence.metadata.settlementGrade ? "Settlement-grade" : "Advisory only"}
            </h2>
            <div className="mt-5 grid gap-3">
              <LedgerMetric label="Missing observations" value={evidence.metadata.missingObservationCount} />
              <div className="rounded-lg bg-fog px-3 py-2">
                <p className="text-sm font-medium text-slate-600">Snapshot</p>
                <p className="mt-1 break-all text-sm font-semibold text-ink">{evidence.metadata.snapshotId}</p>
              </div>
              <div className="rounded-lg bg-fog px-3 py-2">
                <p className="text-sm font-medium text-slate-600">Normalizer</p>
                <p className="mt-1 text-sm font-semibold text-ink">{evidence.metadata.normalizationVersion}</p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-white/80 bg-white/90 p-5 shadow-panel">
            <p className="text-sm font-medium uppercase text-slate-500">Missing-data policy</p>
            <h2 className="mt-1 text-2xl font-semibold">
              {evidence.metadata.missingDataPolicy.replaceAll("_", " ")}
            </h2>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              PIO fails closed when oracle evidence is advisory or incomplete. Gauge can explain the
              issue, but deterministic settlement will not approve a payout from incomplete weather data.
            </p>
            <p className="mt-3 break-all text-xs text-slate-500">{evidence.metadata.sourceUrl}</p>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-[0.7fr_1.3fr]">
          <div className="rounded-lg border border-white/80 bg-white/90 p-5 shadow-panel">
            <p className="text-sm font-medium uppercase text-slate-500">Source of truth</p>
            <h2 className="mt-1 text-2xl font-semibold">Policy ledger</h2>
            <div className="mt-5 grid gap-3">
              <LedgerMetric label="Policy records" value={ledger.policies.length} />
              <LedgerMetric label="Workflow events" value={ledger.workflowEvents.length} />
              <LedgerMetric label="Payment events" value={ledger.paymentEvents.length} />
              <LedgerMetric label="Audit snapshots" value={ledger.auditSnapshots.length} />
            </div>
            <div className="mt-3 rounded-lg bg-fog px-3 py-2">
              <p className="text-sm font-medium text-slate-600">Current-row invariant</p>
              <p className={`mt-1 text-sm font-semibold ${ledgerConsistency.consistent ? "text-mint" : "text-amber"}`}>
                {ledgerConsistency.consistent ? "current rows match ledger events" : "current row drift detected"}
              </p>
              {policyConsistency ? (
                <p className="mt-1 text-xs leading-5 text-slate-500">{policyConsistency.message}</p>
              ) : null}
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              Gauge can explain and operate the flow, but the ledger records the policy state,
              payment references, trigger evidence, payout lock, and immutable terminal audit snapshot.
            </p>
          </div>

          <div className="rounded-lg border border-white/80 bg-white/90 p-5 shadow-panel">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium uppercase text-slate-500">Ledger events</p>
                <h2 className="mt-1 text-2xl font-semibold">Machine-readable audit spine</h2>
              </div>
              <FileCheck2 className="text-rain" size={24} />
            </div>
            <div className="mt-5 grid gap-2">
              {ledger.workflowEvents.slice(-4).map((event) => (
                <div key={event.id} className="rounded-lg bg-fog px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{event.kind.replaceAll("_", " ")}</p>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-500">
                      {event.actor}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{event.summary}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-white/80 bg-white/90 p-5 shadow-panel">
          <p className="text-sm font-medium uppercase text-slate-500">Deterministic controls</p>
          <h2 className="mt-1 text-2xl font-semibold">Allowed policy transitions</h2>
          <div className="mt-5 grid gap-2 md:grid-cols-2">
            {stateRows.map((state) => (
              <div key={state} className="rounded-lg bg-fog px-3 py-2">
                <p className="text-sm font-semibold text-ink">{state.replaceAll("_", " ")}</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {getAllowedTransitions(state)
                    .map((next) => next.replaceAll("_", " "))
                    .join(", ") || "terminal"}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-white/80 bg-white/90 p-5 shadow-panel">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-medium uppercase text-slate-500">Audit report</p>
              <h2 className="mt-1 text-2xl font-semibold">{audit.id}</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-mint/10 px-3 py-1 text-sm font-semibold text-mint">
                {audit.status}
              </span>
              <span className="rounded-full bg-rain/10 px-3 py-1 text-sm font-semibold text-rain">
                {formatDateTime(audit.generatedAt)}
              </span>
              {finalAuditSnapshot ? (
                <span className="rounded-full bg-amber/10 px-3 py-1 text-sm font-semibold text-amber">
                  immutable snapshot
                </span>
              ) : null}
            </div>
          </div>
          <p className="mt-4 max-w-4xl text-sm leading-6 text-slate-700">{audit.summary}</p>
          <div className="mt-5 grid gap-2 md:grid-cols-4">
            {auditTrail.map((report) => (
              <div key={`${report.id}-${report.generatedAt}`} className="rounded-lg bg-fog px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{report.status}</p>
                  <span className="text-xs font-medium text-slate-500">{report.sourceEventCount} events</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{formatDateTime(report.generatedAt)}</p>
              </div>
            ))}
          </div>
          <ul className="mt-4 grid gap-2 md:grid-cols-2">
            {audit.facts.map((fact) => (
              <li key={fact} className="rounded-lg bg-fog px-3 py-2 text-sm font-medium text-slate-700">
                {fact}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

function LedgerMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-fog px-3 py-2">
      <span className="text-sm font-medium text-slate-600">{label}</span>
      <span className="text-lg font-semibold text-ink">{value}</span>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <Icon className="text-rain" size={18} />
      <p className="mt-2 text-xs font-medium uppercase text-slate-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold">{value}</p>
    </div>
  );
}

function PolicyFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-fog p-3">
      <dt className="text-xs font-medium uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm font-semibold">{value}</dd>
    </div>
  );
}

function AuditPanel({ title, body }: { title: string; body: string }) {
  return (
    <article className="rounded-lg border border-white/80 bg-white/90 p-5 shadow-panel">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
    </article>
  );
}

function statusClass(status: "complete" | "blocked" | "pending") {
  const base = "rounded-full px-2 py-0.5 text-xs font-semibold";
  if (status === "complete") return `${base} bg-mint/10 text-mint`;
  if (status === "blocked") return `${base} bg-amber/10 text-amber`;
  return `${base} bg-slate-200 text-slate-700`;
}

function reviewSeverityClass(severity: "high" | "medium") {
  const base = "rounded-full px-2 py-0.5 text-xs font-semibold";
  if (severity === "high") return `${base} bg-rose-100 text-rose-700`;
  return `${base} bg-amber/10 text-amber`;
}
