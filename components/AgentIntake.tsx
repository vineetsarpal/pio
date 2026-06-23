"use client";
import type { DynamicQuoteState } from "./buy-flow";

export function AgentIntake({ state }: { state: Extract<DynamicQuoteState, { phase: "intake" | "priced" }> }) {
  return (
    <div className="panel p-5" aria-live="polite">
      <p className="kicker">Operator intake</p>
      {state.phase === "intake" && state.baseline ? (
        <p className="mt-1 text-sm text-ink-soft">Baseline premium ${state.baseline.premium.amount} — operator researching live risk…</p>
      ) : null}
      <ol className="mt-3 grid gap-2">
        {state.progress.map((e, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${e.source === "operator" ? "bg-rain" : "bg-mint"}`} />
            <span><span className="font-mono text-xs uppercase tracking-wider text-ink-soft">{e.step.replaceAll("_", " ")}</span>{e.detail ? ` — ${e.detail}` : ""}</span>
          </li>
        ))}
        {state.phase === "intake" ? <li className="animate-pulse text-xs text-ink-soft">…waiting for the operator agent</li> : null}
      </ol>
    </div>
  );
}
