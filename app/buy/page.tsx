"use client";

import { FormEvent, useState } from "react";

const defaultRequest = {
  customerName: "North Pier Pop-up Market",
  eventName: "Saturday Harbor Market",
  locationName: "Toronto Waterfront",
  latitude: 43.6405,
  longitude: -79.3764,
  eventStart: "2026-06-20T12:00:00-04:00",
  eventEnd: "2026-06-20T18:00:00-04:00",
  desiredPayout: { amount: 500, currency: "USD" },
  maximumPremium: { amount: 75, currency: "USD" }
};

type CheckoutState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; checkoutUrl: string; checkoutId: string; premium: number; payout: number }
  | { status: "error"; message: string };

export default function BuyPage() {
  const [state, setState] = useState<CheckoutState>({ status: "idle" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState({ status: "loading" });

    const payload = {
      customerName: String(form.get("customerName")),
      eventName: String(form.get("eventName")),
      locationName: String(form.get("locationName")),
      latitude: Number(form.get("latitude")),
      longitude: Number(form.get("longitude")),
      eventStart: String(form.get("eventStart")),
      eventEnd: String(form.get("eventEnd")),
      desiredPayout: { amount: Number(form.get("desiredPayout")), currency: "USD" },
      maximumPremium: { amount: Number(form.get("maximumPremium")), currency: "USD" }
    };

    const response = await fetch("/api/stripe/create-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (!response.ok || !result.accepted) {
      setState({ status: "error", message: result.message ?? "Unable to create checkout." });
      return;
    }

    setState({
      status: "ready",
      checkoutUrl: result.checkout.url,
      checkoutId: result.checkout.id,
      premium: result.policy.premium.amount,
      payout: result.policy.payout.amount
    });
  }

  return (
    <main className="min-h-screen bg-fog/90 px-4 py-8 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 rounded-lg border border-amber/40 bg-amber/10 p-4 text-sm leading-6 text-slate-700">
          <strong>Hackathon demo only.</strong> PIO uses Stripe test mode and does not issue real
          insurance, coverage, or legally binding payouts.
        </div>

        <section className="rounded-lg border border-white/80 bg-white/90 p-6 shadow-panel">
          <p className="text-sm font-semibold uppercase text-rain">Live purchase path</p>
          <h1 className="mt-2 text-4xl font-semibold">Buy test-mode rain protection</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
            Create a real Stripe Checkout Session for a deterministic $25 demo premium. Policy
            issuance still requires the premium-collected event and the claim payout remains governed
            by PIO's typed state machine.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 grid gap-4 md:grid-cols-2">
            <Field name="customerName" label="Customer" defaultValue={defaultRequest.customerName} />
            <Field name="eventName" label="Event" defaultValue={defaultRequest.eventName} />
            <Field name="locationName" label="Location" defaultValue={defaultRequest.locationName} />
            <Field name="latitude" label="Latitude" defaultValue={String(defaultRequest.latitude)} />
            <Field name="longitude" label="Longitude" defaultValue={String(defaultRequest.longitude)} />
            <Field name="eventStart" label="Event start" defaultValue={defaultRequest.eventStart} />
            <Field name="eventEnd" label="Event end" defaultValue={defaultRequest.eventEnd} />
            <Field name="desiredPayout" label="Desired payout USD" defaultValue="500" />
            <Field name="maximumPremium" label="Maximum premium USD" defaultValue="75" />
            <div className="md:col-span-2">
              <button
                className="rounded-lg bg-rain px-5 py-3 font-semibold text-white shadow-panel disabled:opacity-60"
                disabled={state.status === "loading"}
                type="submit"
              >
                {state.status === "loading" ? "Creating checkout..." : "Create Stripe test checkout"}
              </button>
            </div>
          </form>
        </section>

        <section className="mt-5 rounded-lg border border-white/80 bg-white/90 p-6 shadow-panel">
          <h2 className="text-2xl font-semibold">Checkout result</h2>
          {state.status === "idle" && <p className="mt-3 text-slate-600">Submit the form to create a Stripe test-mode checkout session.</p>}
          {state.status === "error" && (
            <div className="mt-4 rounded-lg border border-amber/30 bg-amber/10 p-4 text-sm leading-6 text-slate-700">
              <p className="font-semibold">Checkout not configured yet</p>
              <p>{state.message}</p>
              <p className="mt-2">Set STRIPE_SECRET_KEY to a Stripe test key and NEXT_PUBLIC_APP_URL to this app URL for the live demo.</p>
            </div>
          )}
          {state.status === "ready" && (
            <div className="mt-4 rounded-lg border border-mint/30 bg-mint/10 p-4">
              <p className="font-semibold text-mint">Stripe Checkout Session created</p>
              <p className="mt-2 text-sm text-slate-700">Premium: ${state.premium} · Fixed payout: ${state.payout} · Session: {state.checkoutId}</p>
              <a className="mt-4 inline-block rounded-lg bg-mint px-5 py-3 font-semibold text-white" href={state.checkoutUrl}>
                Open Stripe Checkout
              </a>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Field({ name, label, defaultValue }: { name: string; label: string; defaultValue: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-600">{label}</span>
      <input
        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-rain"
        defaultValue={defaultValue}
        name={name}
      />
    </label>
  );
}
