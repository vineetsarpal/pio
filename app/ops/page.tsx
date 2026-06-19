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

export default function OpsPage() {
  const { policy, evidence, decision, actions, audit, auditTrail, operatorReviewQueue, ledgerConsistency, ledger } = demoRun;
  const maxRainfall = Math.max(...evidence.observations.map((observation) => observation.rainfallMm ?? 0));
  const finalAuditSnapshot = ledger.auditSnapshots.find((snapshot) => snapshot.report.id === audit.id);
  const policyConsistency = ledgerConsistency.checks.find((check) => check.policyId === policy.id);

  return (
    <main className="px-4 py-8 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <div className="flex items-center gap-3 border-y border-signal/40 bg-signal/5 px-3 py-2 font-mono text-[0.66rem] uppercase tracking-wider text-signal">
          <span className="border border-signal px-1.5 py-0.5">Notice</span>
          <span className="text-ink-soft">
            Operator dashboard — Stripe test mode. Demonstrates parametric coverage controls; no real
            insurance, coverage, or legally binding payouts.
          </span>
        </div>

        {/* Masthead / policy header */}
        <header className="grid gap-px border border-ink bg-line md:grid-cols-[1.15fr_0.85fr]">
          <section className="flex flex-col justify-between gap-6 bg-card p-6">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 border border-rain bg-rain/10 px-3 py-1 font-mono text-[0.68rem] uppercase tracking-kicker text-rain">
                <Bot size={14} />
                Gauge operating in demo mode
              </div>
              <h1 className="max-w-3xl text-balance font-display text-4xl font-semibold leading-[1.02] tracking-tight sm:text-5xl">
                PIO runs automatic rain cover from quote to claim.
              </h1>
              <p className="mt-4 max-w-2xl text-pretty leading-7 text-ink-soft">
                A simulated parametric policy for outdoor markets: Stripe test-mode premium
                collection, seeded weather replay, deterministic trigger evaluation, and an audit
                trail generated from the evidence.
              </p>
            </div>
            <div className="grid gap-px border border-line bg-line sm:grid-cols-3">
              <Metric icon={MapPin} label="Location" value={policy.locationName} />
              <Metric icon={CalendarClock} label="Window" value="12 PM – 6 PM" />
              <Metric icon={FileCheck2} label="Certificate" value={policy.certificateId} />
            </div>
          </section>

          <section className="bg-card p-6">
            <div className="flex items-start justify-between gap-3 border-b border-line pb-4">
              <div>
                <p className="kicker">Simulated policy</p>
                <h2 className="mt-1 font-display text-2xl font-semibold">{policy.eventName}</h2>
              </div>
              <span className="tag text-mint">{policy.status.replaceAll("_", " ")}</span>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-px border border-line bg-line">
              <PolicyFact label="Customer" value={policy.customerName} />
              <PolicyFact label="Oracle" value={evidence.source.replaceAll("_", " ")} />
              <PolicyFact label="Premium" value={formatMoney(policy.premium)} />
              <PolicyFact label="Fixed payout" value={formatMoney(policy.payout)} />
              <PolicyFact label="Event starts" value={formatDateTime(policy.trigger.window.start)} />
              <PolicyFact label="Event ends" value={formatDateTime(policy.trigger.window.end)} />
            </dl>
          </section>
        </header>

        {/* Stage cards */}
        <section className="grid gap-px border border-line bg-line md:grid-cols-4">
          {stageCards.map((card) => (
            <div key={card.label} className="bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="kicker">{card.label}</p>
                  <p className="mt-1 font-display text-3xl font-semibold">{card.value}</p>
                </div>
                <card.icon className="text-rain" size={20} />
              </div>
              <p className="mt-3 text-sm leading-6 text-ink-soft">{card.description}</p>
            </div>
          ))}
        </section>

        {/* Gauge + action log */}
        <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <div className="panel p-5">
            <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
              <div>
                <p className="kicker">Monitoring</p>
                <h2 className="mt-1 font-display text-2xl font-semibold">Rainfall gauge</h2>
              </div>
              <div className="tag text-amber">
                <Waves size={13} />
                {decision.rainfallTotalMm.toFixed(1)} mm total
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              {/* y-axis caption */}
              <div className="flex flex-col justify-between pb-7 font-mono text-[0.6rem] text-ink-soft">
                <span>{Math.ceil(maxRainfall)}mm</span>
                <span>0</span>
              </div>
              <div className="relative flex-1">
                {/* trigger threshold annotation */}
                <div
                  className="pointer-events-none absolute left-0 right-0 z-10 flex items-center"
                  style={{ bottom: `${(policy.trigger.threshold / maxRainfall) * 180 + 28}px` }}
                >
                  <div className="h-px flex-1 border-t border-dashed border-signal" />
                  <span className="ml-2 bg-signal px-1.5 py-0.5 font-mono text-[0.58rem] font-semibold uppercase tracking-wider text-card">
                    Trigger {policy.trigger.threshold}mm
                  </span>
                </div>
                <div className="flex h-56 items-end gap-1.5 border-b-2 border-ink pb-1">
                  {evidence.observations.map((observation) => {
                    const inWindow =
                      new Date(observation.observedAt) >= new Date(policy.trigger.window.start) &&
                      new Date(observation.observedAt) <= new Date(policy.trigger.window.end);
                    return (
                      <div key={observation.observedAt} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                        <div
                          className={`w-full ${
                            inWindow ? "bg-rain" : "border border-line bg-paper/60"
                          }`}
                          style={{
                            height: `${Math.max(8, (((observation.rainfallMm ?? 0) / maxRainfall) * 180) || 8)}px`
                          }}
                          title={observation.rainfallMm === null ? "missing" : `${observation.rainfallMm} mm`}
                        />
                        <span className="font-mono text-[0.6rem] text-ink-soft">
                          {new Date(observation.observedAt).getHours()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="mt-5 border-l-2 border-mint bg-mint/10 px-4 py-3">
              <p className="font-mono text-[0.66rem] uppercase tracking-wider text-mint">Claim approved</p>
              <p className="mt-1 text-sm leading-6 text-ink-soft">{decision.reason}</p>
            </div>
          </div>

          <div className="panel p-5">
            <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
              <div>
                <p className="kicker">Gauge action log</p>
                <h2 className="mt-1 font-display text-2xl font-semibold">Agent-operated workflow</h2>
              </div>
              <Bot className="text-rain" size={22} />
            </div>
            <div className="mt-2 divide-y divide-line">
              {actions.map((action) => (
                <article key={action.id} className="grid gap-3 py-3.5 sm:grid-cols-[9rem_1fr]">
                  <div>
                    <p className="font-mono text-sm font-semibold text-ink">{action.actor}</p>
                    <p className="mt-1 font-mono text-[0.66rem] text-ink-soft">{formatDateTime(action.at)}</p>
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-lg font-semibold">{action.action}</h3>
                      <span className={statusClass(action.status)}>{action.status}</span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-ink-soft">{action.detail}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* Stance panels */}
        <section className="grid gap-px border border-line bg-line lg:grid-cols-3">
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

        <section className="panel p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="kicker">Agent buyer path</p>
              <h2 className="mt-1 font-display text-2xl font-semibold">Customer-owned agents can request coverage</h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-ink-soft">
                <code className="font-mono text-rain">POST /api/agent/coverage-request</code> returns a
                quote or a machine-readable rejection.{" "}
                <code className="font-mono text-rain">POST /api/agent/confirm-purchase</code> then creates
                checkout only with explicit authorization and an idempotency key.
              </p>
            </div>
            <Code2 className="shrink-0 text-rain" size={22} />
          </div>
          <div className="mt-5 grid gap-px border border-line bg-line md:grid-cols-3">
            <PolicyFact label="Intent" value="buy_if_within_budget" />
            <PolicyFact label="Budget cap" value="$75" />
            <PolicyFact label="Guardrail" value="confirm + idempotency" />
          </div>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="panel p-5">
            <p className="kicker">Payment truth</p>
            <h2 className="mt-1 font-display text-2xl font-semibold">Premium completion is event-driven</h2>
            <div className="mt-5 grid gap-px border border-line bg-line sm:grid-cols-3">
              <PolicyFact label="Webhook" value="/api/stripe/premium-collected" />
              <PolicyFact label="Event" value="premium_collected" />
              <PolicyFact label="Activation" value="premium_paid state" />
            </div>
            <p className="mt-4 text-sm leading-6 text-ink-soft">
              Gauge can request checkout and narrate verification, but policy issuance depends on the
              <code className="mx-1 font-mono text-rain">premium_collected</code> event tied to the
              checkout id.
            </p>
          </div>

          <div className="panel p-5">
            <p className="kicker">Payout truth</p>
            <h2 className="mt-1 font-display text-2xl font-semibold">Approval &amp; payout completion are separate</h2>
            <div className="mt-5 grid gap-px border border-line bg-line sm:grid-cols-3">
              <PolicyFact label="Request event" value="payout_requested" />
              <PolicyFact label="Success event" value="payout_issued" />
              <PolicyFact label="Failure event" value="payout_failed" />
            </div>
            <p className="mt-4 text-sm leading-6 text-ink-soft">
              Deterministic settlement approves the claim and requests payout. Stripe Skills then
              report payout completion or failure without changing the trigger decision.
            </p>
          </div>
        </section>

        <section className="panel p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="kicker">Operator review</p>
              <h2 className="mt-1 font-display text-2xl font-semibold">Human queue for controlled exceptions</h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-ink-soft">
                PIO keeps clean claims automatic while routing advisory weather evidence and failed
                payout events to an operator-owned lane.
              </p>
            </div>
            <div className="tag text-amber">
              <TriangleAlert size={13} />
              {operatorReviewQueue.length} open
            </div>
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-[0.85fr_1.15fr]">
            <div className="grid gap-px self-start border border-line bg-line sm:grid-cols-2 lg:grid-cols-1">
              <PolicyFact label="Manual weather" value="manual_review" />
              <PolicyFact label="Payment exception" value="payout_failed" />
            </div>
            <div className="grid gap-2">
              {operatorReviewQueue.length > 0 ? (
                operatorReviewQueue.map((item) => (
                  <article key={item.id} className="border-l-2 border-amber bg-paper/50 px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-display text-base font-semibold">{item.title}</p>
                      <span className={reviewSeverityClass(item.severity)}>{item.severity}</span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-ink-soft">{item.summary}</p>
                    <p className="mt-2 font-mono text-[0.62rem] uppercase tracking-wider text-ink-soft">{item.nextAction}</p>
                  </article>
                ))
              ) : (
                <div className="border-l-2 border-mint bg-paper/50 px-3 py-3">
                  <div className="flex items-center gap-2">
                    <ClipboardCheck className="text-mint" size={16} />
                    <p className="font-mono text-[0.66rem] uppercase tracking-wider text-mint">No open operator reviews</p>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-ink-soft">
                    The demo claim used settlement-grade weather evidence and completed the Stripe
                    test-mode payout.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="panel p-5">
            <p className="kicker">Oracle evidence</p>
            <h2 className="mt-1 font-display text-2xl font-semibold">
              {evidence.metadata.settlementGrade ? "Settlement-grade" : "Advisory only"}
            </h2>
            <div className="mt-5 grid gap-2">
              <LedgerMetric label="Missing observations" value={evidence.metadata.missingObservationCount} />
              <div className="quiet px-3 py-2">
                <p className="font-mono text-[0.62rem] uppercase tracking-wider text-ink-soft">Snapshot</p>
                <p className="mt-1 break-all font-mono text-sm font-semibold text-ink">{evidence.metadata.snapshotId}</p>
              </div>
              <div className="quiet px-3 py-2">
                <p className="font-mono text-[0.62rem] uppercase tracking-wider text-ink-soft">Normalizer</p>
                <p className="mt-1 font-mono text-sm font-semibold text-ink">{evidence.metadata.normalizationVersion}</p>
              </div>
            </div>
          </div>
          <div className="panel p-5">
            <p className="kicker">Missing-data policy</p>
            <h2 className="mt-1 font-display text-2xl font-semibold">
              {evidence.metadata.missingDataPolicy.replaceAll("_", " ")}
            </h2>
            <p className="mt-4 text-sm leading-6 text-ink-soft">
              PIO fails closed when oracle evidence is advisory or incomplete. Gauge can explain the
              issue, but deterministic settlement will not approve a payout from incomplete weather
              data.
            </p>
            <p className="mt-3 break-all font-mono text-xs text-ink-soft/80">{evidence.metadata.sourceUrl}</p>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.7fr_1.3fr]">
          <div className="panel p-5">
            <p className="kicker">Source of truth</p>
            <h2 className="mt-1 font-display text-2xl font-semibold">Policy ledger</h2>
            <div className="mt-5 grid gap-2">
              <LedgerMetric label="Policy records" value={ledger.policies.length} />
              <LedgerMetric label="Workflow events" value={ledger.workflowEvents.length} />
              <LedgerMetric label="Payment events" value={ledger.paymentEvents.length} />
              <LedgerMetric label="Audit snapshots" value={ledger.auditSnapshots.length} />
            </div>
            <div className="mt-3 quiet px-3 py-2">
              <p className="font-mono text-[0.62rem] uppercase tracking-wider text-ink-soft">Current-row invariant</p>
              <p className={`mt-1 font-mono text-sm font-semibold ${ledgerConsistency.consistent ? "text-mint" : "text-signal"}`}>
                {ledgerConsistency.consistent ? "current rows match ledger events" : "current row drift detected"}
              </p>
              {policyConsistency ? (
                <p className="mt-1 text-xs leading-5 text-ink-soft">{policyConsistency.message}</p>
              ) : null}
            </div>
            <p className="mt-4 text-sm leading-6 text-ink-soft">
              Gauge can explain and operate the flow, but the ledger records the policy state,
              payment references, trigger evidence, payout lock, and immutable terminal audit
              snapshot.
            </p>
          </div>

          <div className="panel p-5">
            <div className="flex items-center justify-between gap-3 border-b border-line pb-3">
              <div>
                <p className="kicker">Ledger events</p>
                <h2 className="mt-1 font-display text-2xl font-semibold">Machine-readable audit spine</h2>
              </div>
              <FileCheck2 className="text-rain" size={22} />
            </div>
            <div className="mt-4 grid gap-2">
              {ledger.workflowEvents.slice(-4).map((event) => (
                <div key={event.id} className="border-l-2 border-rain bg-paper/50 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-sm font-semibold">{event.kind.replaceAll("_", " ")}</p>
                    <span className="border border-line px-1.5 py-0.5 font-mono text-[0.6rem] uppercase tracking-wider text-ink-soft">
                      {event.actor}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-ink-soft">{event.summary}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="panel p-5">
          <p className="kicker">Deterministic controls</p>
          <h2 className="mt-1 font-display text-2xl font-semibold">Allowed policy transitions</h2>
          <div className="mt-5 grid gap-px border border-line bg-line md:grid-cols-2">
            {stateRows.map((state) => (
              <div key={state} className="bg-card px-3 py-2.5">
                <p className="font-mono text-sm font-semibold text-rain">{state.replaceAll("_", " ")}</p>
                <p className="mt-1 text-sm leading-6 text-ink-soft">
                  <span className="text-ink-soft/60">→ </span>
                  {getAllowedTransitions(state)
                    .map((next) => next.replaceAll("_", " "))
                    .join(", ") || "terminal"}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="relative border border-ink bg-card p-6 shadow-riso">
          <div className="flex flex-col gap-2 border-b border-line pb-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="kicker">Audit report</p>
              <h2 className="mt-1 font-display text-2xl font-semibold">{audit.id}</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="tag text-mint">{audit.status}</span>
              <span className="tag text-rain">{formatDateTime(audit.generatedAt)}</span>
              {finalAuditSnapshot ? <span className="tag text-amber">immutable snapshot</span> : null}
            </div>
          </div>
          <p className="mt-4 max-w-4xl text-pretty leading-7 text-ink-soft">{audit.summary}</p>
          <div className="mt-5 grid gap-px border border-line bg-line md:grid-cols-4">
            {auditTrail.map((report) => (
              <div key={`${report.id}-${report.generatedAt}`} className="bg-card px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-sm font-semibold">{report.status}</p>
                  <span className="font-mono text-[0.6rem] text-ink-soft">{report.sourceEventCount} ev</span>
                </div>
                <p className="mt-1 font-mono text-[0.66rem] text-ink-soft">{formatDateTime(report.generatedAt)}</p>
              </div>
            ))}
          </div>
          <ul className="mt-4 grid gap-px border border-line bg-line md:grid-cols-2">
            {audit.facts.map((fact) => (
              <li key={fact} className="flex gap-2 bg-card px-3 py-2.5 text-sm font-medium text-ink-soft">
                <span className="text-mint">✓</span>
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
    <div className="flex items-center justify-between gap-3 quiet px-3 py-2">
      <span className="text-sm font-medium text-ink-soft">{label}</span>
      <span className="font-display text-xl font-semibold text-ink">{value}</span>
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
    <div className="bg-card p-3">
      <Icon className="text-rain" size={16} />
      <p className="mt-2 font-mono text-[0.6rem] uppercase tracking-wider text-ink-soft">{label}</p>
      <p className="mt-1 truncate font-mono text-sm font-semibold">{value}</p>
    </div>
  );
}

function PolicyFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-3">
      <dt className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-soft">{label}</dt>
      <dd className="mt-1 font-mono text-sm font-semibold">{value}</dd>
    </div>
  );
}

function AuditPanel({ title, body }: { title: string; body: string }) {
  return (
    <article className="bg-card p-5">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-ink-soft">{body}</p>
    </article>
  );
}

function statusClass(status: "complete" | "blocked" | "pending") {
  const base = "border px-2 py-0.5 font-mono text-[0.62rem] font-semibold uppercase tracking-wider";
  if (status === "complete") return `${base} border-mint text-mint`;
  if (status === "blocked") return `${base} border-signal text-signal`;
  return `${base} border-line text-ink-soft`;
}

function reviewSeverityClass(severity: "high" | "medium") {
  const base = "border px-2 py-0.5 font-mono text-[0.62rem] font-semibold uppercase tracking-wider";
  if (severity === "high") return `${base} border-signal text-signal`;
  return `${base} border-amber text-amber`;
}
