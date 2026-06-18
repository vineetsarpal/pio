"use client";

import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import { Activity, CalendarClock, CloudRain, Plane, ShieldCheck, Sparkles } from "lucide-react";

type ProductId = "rain_event" | "flight_delay";

type Money = {
  amount: number;
  currency: "USD";
};

type RiskAssessment = {
  source: string;
  sourceLabel: string;
  apiStatus: "live" | "demo_fallback" | "demo";
  apiCall: {
    toolName: string;
    method: "GET" | "POST" | "SIMULATED";
    endpoint: string;
    status: "success" | "fallback" | "simulated";
    calledAt: string;
    latencyMs: number;
    purpose: string;
  };
  score: number;
  factors: string[];
  observedMetric: {
    label: string;
    value: string;
  };
};

type PolicyPacket = {
  certificateId: string;
  title: string;
  insured: string;
  coverageSummary: string;
  triggerSummary: string;
  premiumSummary: string;
  dataSources: string[];
  exclusions: string[];
  issueCondition: string;
};

type ProductQuote = {
  product: {
    id: ProductId;
    name: string;
    tagline: string;
  };
  policy: {
    id: string;
    certificateId: string;
    eventName: string;
    locationName: string;
    premium: Money;
    payout: Money;
    trigger: {
      variable: "rainfall_mm" | "arrival_delay_minutes";
      threshold: number;
      window: {
        start: string;
        end: string;
      };
    };
    riskScore?: number;
  };
  risk: RiskAssessment;
  packet: PolicyPacket;
  agentNarrative: string[];
};

type QuoteState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "quoted"; quote: ProductQuote; payload: ProductPayload }
  | { status: "checkout"; quote: ProductQuote; checkoutUrl: string; checkoutId: string }
  | { status: "error"; message: string };

type RainPayload = {
  productId: "rain_event";
  customerName: string;
  eventName: string;
  locationName: string;
  latitude: number;
  longitude: number;
  eventStart: string;
  eventEnd: string;
  desiredPayout: Money;
  maximumPremium: Money;
};

type FlightPayload = {
  productId: "flight_delay";
  customerName: string;
  passengerName: string;
  airline: string;
  flightNumber: string;
  originAirport: string;
  destinationAirport: string;
  departureTime: string;
  arrivalTime: string;
  desiredPayout: Money;
  maximumPremium: Money;
};

type ProductPayload = RainPayload | FlightPayload;

const products = [
  {
    id: "rain_event" as const,
    name: "Rain event protection",
    description: "Outdoor event cover priced with weather risk.",
    trigger: "Rainfall total > 5 mm",
    api: "Weather API",
    icon: CloudRain
  },
  {
    id: "flight_delay" as const,
    name: "Flight delay protection",
    description: "Trip cover priced with route delay risk.",
    trigger: "Arrival delay > 90 min",
    api: "Flight status API",
    icon: Plane
  }
];

const defaultRain = {
  customerName: "North Pier Pop-up Market",
  eventName: "Saturday Harbor Market",
  locationName: "Toronto Waterfront",
  latitude: "43.6405",
  longitude: "-79.3764",
  eventStart: "2026-06-20T12:00",
  eventEnd: "2026-06-20T18:00",
  desiredPayout: "500",
  maximumPremium: "85"
};

const defaultFlight = {
  customerName: "Avery Chen",
  passengerName: "Avery Chen",
  airline: "Air Canada",
  flightNumber: "AC101",
  originAirport: "YYZ",
  destinationAirport: "YVR",
  departureTime: "2026-06-21T17:15",
  arrivalTime: "2026-06-21T19:30",
  desiredPayout: "400",
  maximumPremium: "90"
};

export default function BuyPage() {
  const [activeProduct, setActiveProduct] = useState<ProductId>("rain_event");
  const [state, setState] = useState<QuoteState>({ status: "idle" });

  const selectedProduct = products.find((product) => product.id === activeProduct) ?? products[0];

  async function handleQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = activeProduct === "rain_event" ? buildRainPayload(form) : buildFlightPayload(form);

    setState({ status: "loading" });
    const response = await fetch("/api/products/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (!response.ok || !result.accepted) {
      setState({ status: "error", message: result.message ?? "Unable to quote coverage." });
      return;
    }

    setState({ status: "quoted", quote: result.quote, payload });
  }

  async function createCheckout() {
    if (state.status !== "quoted") return;

    setState({ status: "loading" });
    const response = await fetch("/api/stripe/create-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.payload)
    });
    const result = await response.json();

    if (!response.ok || !result.accepted) {
      setState({ status: "error", message: result.message ?? "Unable to create checkout." });
      return;
    }

    setState({
      status: "checkout",
      quote: result.productQuote ?? state.quote,
      checkoutUrl: result.checkout.url,
      checkoutId: result.checkout.id
    });
  }

  return (
    <main className="min-h-screen bg-fog/90 px-4 py-8 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 rounded-lg border border-amber/40 bg-amber/10 p-4 text-sm leading-6 text-slate-700">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p>
              <strong>Hackathon demo only.</strong> PIO uses Stripe test mode and does not issue real
              insurance, coverage, or legally binding payouts.
            </p>
            <div className="flex shrink-0 flex-wrap gap-3">
              <a className="font-semibold text-rain" href="/">
                Home
              </a>
              <a className="font-semibold text-rain" href="/ops">
                Operator dashboard
              </a>
            </div>
          </div>
        </div>

        <section className="rounded-lg border border-white/80 bg-white/90 p-6 shadow-panel">
          <p className="text-sm font-semibold uppercase text-rain">Coverage catalog</p>
          <h1 className="mt-2 text-4xl font-semibold">Choose parametric protection</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600">
            Hermes guides the customer through a product-specific intake, calls the relevant risk API,
            prices the premium, and prepares a policy packet for Stripe-backed issuance.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {products.map((product) => {
              const Icon = product.icon;
              const selected = product.id === activeProduct;
              return (
                <button
                  key={product.id}
                  className={`rounded-lg border p-5 text-left transition ${
                    selected
                      ? "border-rain bg-rain/10 shadow-panel"
                      : "border-slate-200 bg-white hover:border-mint/60"
                  }`}
                  type="button"
                  onClick={() => {
                    setActiveProduct(product.id);
                    setState({ status: "idle" });
                  }}
                >
                  <div className="flex items-start gap-4">
                    <span className={`rounded-lg p-3 ${selected ? "bg-rain text-white" : "bg-slate-100 text-rain"}`}>
                      <Icon size={24} />
                    </span>
                    <span>
                      <span className="block text-lg font-semibold">{product.name}</span>
                      <span className="mt-1 block text-sm leading-6 text-slate-600">{product.description}</span>
                      <span className="mt-3 flex flex-wrap gap-2 text-xs font-semibold uppercase text-slate-500">
                        <span className="rounded bg-slate-100 px-2 py-1">{product.trigger}</span>
                        <span className="rounded bg-slate-100 px-2 py-1">{product.api}</span>
                      </span>
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <div className="mt-5 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="rounded-lg border border-white/80 bg-white/90 p-6 shadow-panel">
            <div className="flex items-center gap-3">
              <span className="rounded-lg bg-mint/15 p-2 text-mint">
                <Sparkles size={20} />
              </span>
              <div>
                <p className="text-sm font-semibold uppercase text-mint">Hermes intake</p>
                <h2 className="text-2xl font-semibold">{selectedProduct.name}</h2>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <AgentBubble>Selected {selectedProduct.name}. I will capture only the fields needed to quote this parametric cover.</AgentBubble>
              <AgentBubble>I will call the {selectedProduct.api.toLowerCase()} before pricing so premium changes with risk.</AgentBubble>
              {state.status === "quoted" || state.status === "checkout" ? (
                <>
                  {(state.status === "quoted" ? state.quote : state.quote).agentNarrative.map((line) => (
                    <AgentBubble key={line}>{line}</AgentBubble>
                  ))}
                </>
              ) : null}
              {state.status === "loading" ? <AgentBubble>Calling the risk adapter and pricing engine...</AgentBubble> : null}
            </div>
          </section>

          <section className="rounded-lg border border-white/80 bg-white/90 p-6 shadow-panel">
            <div className="flex items-center gap-3">
              <span className="rounded-lg bg-rain/10 p-2 text-rain">
                <CalendarClock size={20} />
              </span>
              <div>
                <p className="text-sm font-semibold uppercase text-rain">Questionnaire</p>
                <h2 className="text-2xl font-semibold">Coverage details</h2>
              </div>
            </div>

            <form onSubmit={handleQuote} className="mt-6 grid gap-4 md:grid-cols-2">
              {activeProduct === "rain_event" ? <RainFields /> : <FlightFields />}
              <div className="md:col-span-2">
                <button
                  className="inline-flex items-center gap-2 rounded-lg bg-rain px-5 py-3 font-semibold text-white shadow-panel disabled:opacity-60"
                  disabled={state.status === "loading"}
                  type="submit"
                >
                  <ShieldCheck size={18} />
                  {state.status === "loading" ? "Pricing coverage..." : "Get dynamic quote"}
                </button>
              </div>
            </form>
          </section>
        </div>

        <section className="mt-5 rounded-lg border border-white/80 bg-white/90 p-6 shadow-panel">
          <h2 className="text-2xl font-semibold">Quote and policy packet</h2>
          {state.status === "idle" ? (
            <p className="mt-3 text-slate-600">Choose a coverage card and submit the questionnaire to price a policy.</p>
          ) : null}
          {state.status === "error" ? (
            <div className="mt-4 rounded-lg border border-amber/30 bg-amber/10 p-4 text-sm leading-6 text-slate-700">
              <p className="font-semibold">Quote unavailable</p>
              <p>{state.message}</p>
            </div>
          ) : null}
          {state.status === "quoted" || state.status === "checkout" ? (
            <QuoteResult quote={state.quote} checkoutState={state} onCreateCheckout={createCheckout} />
          ) : null}
        </section>
      </div>
    </main>
  );
}

function RainFields() {
  return (
    <>
      <Field name="customerName" label="Customer" defaultValue={defaultRain.customerName} />
      <Field name="eventName" label="Event" defaultValue={defaultRain.eventName} />
      <Field name="locationName" label="Location" defaultValue={defaultRain.locationName} />
      <Field name="latitude" label="Latitude" defaultValue={defaultRain.latitude} />
      <Field name="longitude" label="Longitude" defaultValue={defaultRain.longitude} />
      <Field name="eventStart" label="Event start" defaultValue={defaultRain.eventStart} type="datetime-local" />
      <Field name="eventEnd" label="Event end" defaultValue={defaultRain.eventEnd} type="datetime-local" />
      <Field name="desiredPayout" label="Desired payout USD" defaultValue={defaultRain.desiredPayout} />
      <Field name="maximumPremium" label="Maximum premium USD" defaultValue={defaultRain.maximumPremium} />
    </>
  );
}

function FlightFields() {
  return (
    <>
      <Field name="customerName" label="Customer" defaultValue={defaultFlight.customerName} />
      <Field name="passengerName" label="Passenger" defaultValue={defaultFlight.passengerName} />
      <Field name="airline" label="Airline" defaultValue={defaultFlight.airline} />
      <Field name="flightNumber" label="Flight number" defaultValue={defaultFlight.flightNumber} />
      <Field name="originAirport" label="Origin airport" defaultValue={defaultFlight.originAirport} />
      <Field name="destinationAirport" label="Destination airport" defaultValue={defaultFlight.destinationAirport} />
      <Field name="departureTime" label="Departure time" defaultValue={defaultFlight.departureTime} type="datetime-local" />
      <Field name="arrivalTime" label="Scheduled arrival" defaultValue={defaultFlight.arrivalTime} type="datetime-local" />
      <Field name="desiredPayout" label="Desired payout USD" defaultValue={defaultFlight.desiredPayout} />
      <Field name="maximumPremium" label="Maximum premium USD" defaultValue={defaultFlight.maximumPremium} />
    </>
  );
}

function QuoteResult({
  quote,
  checkoutState,
  onCreateCheckout
}: {
  quote: ProductQuote;
  checkoutState: Extract<QuoteState, { status: "quoted" | "checkout" }>;
  onCreateCheckout: () => void;
}) {
  return (
    <div className="mt-5 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-5">
        <p className="text-sm font-semibold uppercase text-slate-500">Dynamic price</p>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Metric label="Premium" value={`$${quote.policy.premium.amount}`} />
          <Metric label="Payout" value={`$${quote.policy.payout.amount}`} />
          <Metric label="Risk score" value={`${quote.risk.score}/100`} />
        </div>
        <div className="mt-4 rounded-lg border border-mint/20 bg-white p-4">
          <p className="font-semibold text-mint">{quote.risk.sourceLabel}</p>
          <p className="mt-1 break-all text-sm text-slate-600">{quote.risk.source}</p>
          <p className="mt-3 text-sm text-slate-700">
            {quote.risk.observedMetric.label}: <strong>{quote.risk.observedMetric.value}</strong>
          </p>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
            {quote.risk.factors.map((factor) => (
              <li key={factor}>- {factor}</li>
            ))}
          </ul>
        </div>
        <ApiTelemetryPanel risk={quote.risk} />
        {checkoutState.status === "quoted" ? (
          <button
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-mint px-5 py-3 font-semibold text-white shadow-panel"
            type="button"
            onClick={onCreateCheckout}
          >
            <ShieldCheck size={18} />
            Create Stripe checkout
          </button>
        ) : (
          <div className="mt-5 rounded-lg border border-mint/30 bg-mint/10 p-4">
            <p className="font-semibold text-mint">Stripe Checkout Session created</p>
            <p className="mt-2 break-all text-sm text-slate-700">Session: {checkoutState.checkoutId}</p>
            <a className="mt-4 inline-block rounded-lg bg-mint px-5 py-3 font-semibold text-white" href={checkoutState.checkoutUrl}>
              Open Stripe Checkout
            </a>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <p className="text-sm font-semibold uppercase text-slate-500">Policy packet</p>
        <h3 className="mt-2 text-xl font-semibold">{quote.packet.title}</h3>
        <dl className="mt-4 grid gap-3 text-sm">
          <PacketRow label="Certificate" value={quote.packet.certificateId} />
          <PacketRow label="Insured" value={quote.packet.insured} />
          <PacketRow label="Coverage" value={quote.packet.coverageSummary} />
          <PacketRow label="Trigger" value={quote.packet.triggerSummary} />
          <PacketRow label="Premium" value={quote.packet.premiumSummary} />
          <PacketRow label="Issue condition" value={quote.packet.issueCondition} />
        </dl>
      </div>
    </div>
  );
}

function ApiTelemetryPanel({ risk }: { risk: RiskAssessment }) {
  return (
    <div className="mt-4 rounded-lg border border-rain/20 bg-rain/5 p-4">
      <div className="flex items-center gap-2">
        <span className="rounded bg-white p-2 text-rain">
          <Activity size={18} />
        </span>
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">API call telemetry</p>
          <p className="font-semibold text-rain">{risk.apiCall.toolName}</p>
        </div>
      </div>
      <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
        <TelemetryMetric label="Method" value={risk.apiCall.method} />
        <TelemetryMetric label="Status" value={formatApiStatus(risk.apiCall.status)} />
        <TelemetryMetric label="Latency" value={`${risk.apiCall.latencyMs} ms`} />
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-700">{risk.apiCall.purpose}</p>
      <p className="mt-2 break-all text-xs text-slate-500">{risk.apiCall.endpoint}</p>
      <p className="mt-1 text-xs text-slate-500">Called at {new Date(risk.apiCall.calledAt).toLocaleString()}</p>
    </div>
  );
}

function TelemetryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-white p-3">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-slate-800">{value}</p>
    </div>
  );
}

function AgentBubble({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
      {children}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white p-3">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}

function formatApiStatus(status: RiskAssessment["apiCall"]["status"]): string {
  if (status === "success") return "Live success";
  if (status === "fallback") return "Demo fallback";
  return "Simulated";
}

function PacketRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-medium text-slate-500">{label}</dt>
      <dd className="mt-1 text-slate-800">{value}</dd>
    </div>
  );
}

function Field({
  name,
  label,
  defaultValue,
  type = "text"
}: {
  name: string;
  label: string;
  defaultValue: string;
  type?: string;
}) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <input
        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-ink outline-none ring-rain/20 focus:ring-4"
        name={name}
        type={type}
        defaultValue={defaultValue}
      />
    </label>
  );
}

function buildRainPayload(form: FormData): RainPayload {
  return {
    productId: "rain_event",
    customerName: readString(form, "customerName"),
    eventName: readString(form, "eventName"),
    locationName: readString(form, "locationName"),
    latitude: readNumber(form, "latitude"),
    longitude: readNumber(form, "longitude"),
    eventStart: readString(form, "eventStart"),
    eventEnd: readString(form, "eventEnd"),
    desiredPayout: { amount: readNumber(form, "desiredPayout"), currency: "USD" },
    maximumPremium: { amount: readNumber(form, "maximumPremium"), currency: "USD" }
  };
}

function buildFlightPayload(form: FormData): FlightPayload {
  return {
    productId: "flight_delay",
    customerName: readString(form, "customerName"),
    passengerName: readString(form, "passengerName"),
    airline: readString(form, "airline"),
    flightNumber: readString(form, "flightNumber"),
    originAirport: readString(form, "originAirport"),
    destinationAirport: readString(form, "destinationAirport"),
    departureTime: readString(form, "departureTime"),
    arrivalTime: readString(form, "arrivalTime"),
    desiredPayout: { amount: readNumber(form, "desiredPayout"), currency: "USD" },
    maximumPremium: { amount: readNumber(form, "maximumPremium"), currency: "USD" }
  };
}

function readString(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function readNumber(form: FormData, name: string): number {
  return Number(form.get(name));
}
