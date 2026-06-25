"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Clock, Info } from "lucide-react";
import { resolvePolicyStatusView } from "@/lib/policy-status-view";

const POLL_MS = 1_500;
const TIMEOUT_MS = 20_000;

type StatusResponse = {
  found?: boolean;
  activated?: boolean;
  status?: string;
  certificateId?: string;
  premium?: { amount: number; currency: string };
  eventName?: string;
};

function useQueryParams() {
  const [params, setParams] = useState<{ sessionId?: string; policyId?: string; token?: string }>({});
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setParams({
      sessionId: q.get("session_id") ?? undefined,
      policyId: q.get("policy_id") ?? undefined,
      token: q.get("t") ?? undefined
    });
  }, []);
  return params;
}

export default function BuySuccessPage() {
  const { sessionId, policyId, token } = useQueryParams();
  const [data, setData] = useState<StatusResponse | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startRef = useRef<number>(Date.now());

  const hasCredentials = Boolean(policyId && token);
  const activated = data?.activated === true;

  useEffect(() => {
    if (!policyId || !token) return;
    if (activated) return;

    let cancelled = false;
    startRef.current = Date.now();

    const tick = async () => {
      try {
        const res = await fetch(`/api/buy/policy-status/${policyId}?t=${encodeURIComponent(token)}`);
        if (res.ok && !cancelled) setData((await res.json()) as StatusResponse);
      } catch {
        /* keep polling; surfaces as "taking longer" after the timeout */
      } finally {
        if (!cancelled) setElapsedMs(Date.now() - startRef.current);
      }
    };

    void tick();
    const id = setInterval(() => {
      if (Date.now() - startRef.current >= TIMEOUT_MS) {
        setElapsedMs(Date.now() - startRef.current);
        clearInterval(id);
        return;
      }
      void tick();
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [policyId, token, activated]);

  const view = resolvePolicyStatusView({ hasCredentials, activated, elapsedMs, timeoutMs: TIMEOUT_MS });

  const kicker =
    view === "active"
      ? "Coverage active"
      : view === "missing_link"
        ? "Link incomplete"
        : view === "taking_longer"
          ? "Still confirming"
          : "Confirming with Stripe…";

  const heading =
    view === "active"
      ? "Coverage active"
      : view === "missing_link"
        ? "Open this from your checkout link"
        : "Premium payment ready for verification";

  return (
    <main className="px-4 py-14 text-ink sm:px-6 lg:px-8">
      <div className="reg mx-auto max-w-3xl animate-rise border border-ink bg-card p-7 shadow-riso sm:p-9">
        <div className="flex items-center justify-between border-b border-line pb-4">
          <p className={`kicker ${view === "active" ? "text-mint" : "text-rain"}`}>{kicker}</p>
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-full border ${
              view === "active" ? "border-mint text-mint" : "border-rain text-rain"
            }`}
          >
            {view === "active" ? (
              <CheckCircle2 size={18} />
            ) : view === "missing_link" ? (
              <Info size={18} />
            ) : view === "taking_longer" ? (
              <Clock size={18} />
            ) : (
              <Loader2 size={18} className="animate-spin" />
            )}
          </span>
        </div>

        <h1 className="mt-5 text-balance font-display text-4xl font-semibold leading-tight sm:text-5xl">
          {heading}
        </h1>

        {view === "active" ? (
          <p className="mt-5 text-pretty leading-8 text-ink-soft">
            Stripe&apos;s verified <code className="font-mono text-rain">checkout.session.completed</code> webhook
            posted the immutable <code className="font-mono text-rain">premium_collected</code> event and PIO issued
            the policy. Certificate <span className="font-mono font-semibold">{data?.certificateId}</span> is active.
          </p>
        ) : view === "missing_link" ? (
          <p className="mt-5 text-pretty leading-8 text-ink-soft">
            This page confirms a policy&apos;s activation, but the link is missing the checkout details it needs to
            look one up. Open the success link from your Stripe checkout, or head back to the quote workspace to start
            a new purchase.
          </p>
        ) : view === "taking_longer" ? (
          <p className="mt-5 text-pretty leading-8 text-ink-soft">
            Payment succeeded, but activation runs on Stripe&apos;s asynchronous{" "}
            <code className="font-mono text-rain">checkout.session.completed</code> webhook, which hasn&apos;t landed
            yet. This is normal — it usually arrives within seconds.
          </p>
        ) : (
          <p className="mt-5 text-pretty leading-8 text-ink-soft">
            Stripe&apos;s <code className="font-mono text-rain">checkout.session.completed</code> webhook posts the
            immutable <code className="font-mono text-rain">premium_collected</code> event before PIO issues the
            policy. We&apos;re waiting for that verified event now — coverage is never activated from a redirect alone.
          </p>
        )}

        <dl className="mt-7 grid gap-px border border-line bg-line sm:grid-cols-2">
          <div className="bg-card p-4">
            <dt className="font-mono text-[0.62rem] uppercase tracking-wider text-ink-soft">Checkout session</dt>
            <dd className="mt-1.5 break-all font-mono text-sm font-semibold">{sessionId ?? "missing"}</dd>
          </div>
          <div className="bg-card p-4">
            <dt className="font-mono text-[0.62rem] uppercase tracking-wider text-ink-soft">Policy</dt>
            <dd className="mt-1.5 break-all font-mono text-sm font-semibold">{policyId ?? "missing"}</dd>
          </div>
        </dl>

        <div className="mt-7 flex flex-wrap gap-3">
          {view === "taking_longer" && (
            <button className="btn" onClick={() => window.location.reload()}>
              Refresh
            </button>
          )}
          <a className={view === "taking_longer" ? "btn-ghost" : "btn"} href="/buy">
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
