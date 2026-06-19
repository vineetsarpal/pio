"use client";

import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import { Activity, CalendarClock, CloudRain, Plane, ShieldCheck, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import type { FlightLookupResult } from "@/lib/aerodatabox";

const LocationPicker = dynamic(() => import("@/components/LocationPicker"), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse border border-line md:col-span-2" />
});

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
    coverageAmount?: Money;
    deductible?: Money;
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
  deductible: Money;
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
  deductible: Money;
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
  deductible: "0"
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
  deductible: "0"
};

const rainCoverageAmounts = ["250", "500", "1000"];
const flightCoverageAmounts = ["200", "400", "800"];
const deductibleAmounts = ["0", "50", "100"];
const airlineOptions = [
  { value: "Air Canada", label: "Air Canada (AC)" },
  { value: "WestJet", label: "WestJet (WS)" },
  { value: "Porter Airlines", label: "Porter Airlines (PD)" },
  { value: "American Airlines", label: "American Airlines (AA)" },
  { value: "Delta Air Lines", label: "Delta Air Lines (DL)" },
  { value: "United Airlines", label: "United Airlines (UA)" }
];
const airportOptions = [
  { value: "YYZ", label: "YYZ — Toronto Pearson" },
  { value: "YVR", label: "YVR — Vancouver" },
  { value: "JFK", label: "JFK — New York Kennedy" },
  { value: "LGA", label: "LGA — New York LaGuardia" },
  { value: "EWR", label: "EWR — Newark" },
  { value: "LAX", label: "LAX — Los Angeles" },
  { value: "SFO", label: "SFO — San Francisco" },
  { value: "ORD", label: "ORD — Chicago O'Hare" },
  { value: "ATL", label: "ATL — Atlanta" },
  { value: "DFW", label: "DFW — Dallas/Fort Worth" }
];

export default function BuyPage() {
  const [activeProduct, setActiveProduct] = useState<ProductId>("rain_event");
  const [state, setState] = useState<QuoteState>({ status: "idle" });

  const selectedProduct = products.find((product) => product.id === activeProduct) ?? products[0];

  async function handleQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = activeProduct === "rain_event" ? buildRainPayload(form) : buildFlightPayload(form);

    setState({ status: "loading" });
    try {
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
    } catch {
      setState({
        status: "error",
        message: "Unable to reach the quote service. Check your connection and try again."
      });
    }
  }

  async function createCheckout() {
    if (state.status !== "quoted") return;

    setState({ status: "loading" });
    try {
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
    } catch {
      setState({
        status: "error",
        message: "Unable to reach Stripe checkout. Check your connection and try again."
      });
    }
  }

  return (
    <main className="px-4 py-10 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex items-center gap-3 border-y border-signal/40 bg-signal/5 px-3 py-2 font-mono text-[0.66rem] uppercase tracking-wider text-signal">
          <span className="border border-signal px-1.5 py-0.5">Notice</span>
          <span className="text-ink-soft">
            Hackathon demo only — Stripe test mode. No real insurance, coverage, or legally binding
            payouts.
          </span>
        </div>

        {/* Section header */}
        <div className="mb-8 flex flex-wrap items-end justify-between gap-3 border-b-2 border-ink pb-3">
          <div>
            <p className="kicker text-rain">Coverage catalog</p>
            <h1 className="mt-1 font-display text-5xl font-semibold leading-none tracking-tight">
              Choose parametric protection
            </h1>
          </div>
          <p className="max-w-md text-pretty text-sm leading-6 text-ink-soft">
            The agent guides a product-specific intake, calls the relevant risk API, prices the
            premium, and prepares a policy packet for Stripe-backed issuance.
          </p>
        </div>

        {/* Product selector */}
        <div className="grid gap-px border border-line bg-line md:grid-cols-2">
          {products.map((product) => {
            const Icon = product.icon;
            const selected = product.id === activeProduct;
            return (
              <button
                key={product.id}
                className={`p-5 text-left transition-colors ${
                  selected ? "bg-rain text-card" : "bg-card hover:bg-paper/60"
                }`}
                type="button"
                onClick={() => {
                  setActiveProduct(product.id);
                  setState({ status: "idle" });
                }}
              >
                <div className="flex items-start gap-4">
                  <span
                    className={`flex h-12 w-12 shrink-0 items-center justify-center border ${
                      selected ? "border-card/60 bg-card/15 text-card" : "border-ink bg-rain/10 text-rain"
                    }`}
                  >
                    <Icon size={22} />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-display text-xl font-semibold">{product.name}</span>
                    <span className={`mt-1 block text-sm leading-6 ${selected ? "text-card/80" : "text-ink-soft"}`}>
                      {product.description}
                    </span>
                    <span className="mt-3 flex flex-wrap gap-2 font-mono text-[0.62rem] font-semibold uppercase tracking-wider">
                      <span className={`border px-2 py-0.5 ${selected ? "border-card/50" : "border-line"}`}>
                        {product.trigger}
                      </span>
                      <span className={`border px-2 py-0.5 ${selected ? "border-card/50" : "border-line"}`}>
                        {product.api}
                      </span>
                    </span>
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <section className="panel reg p-6">
            <div className="flex items-center gap-3 border-b border-line pb-4">
              <span className="flex h-10 w-10 items-center justify-center border border-mint bg-mint/10 text-mint">
                <Sparkles size={18} />
              </span>
              <div>
                <p className="kicker text-mint">Agent intake</p>
                <h2 className="font-display text-2xl font-semibold">{selectedProduct.name}</h2>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              <AgentBubble>
                Selected {selectedProduct.name}. I will capture only the fields needed to quote this
                parametric cover.
              </AgentBubble>
              <AgentBubble>
                I will call the {selectedProduct.api.toLowerCase()} before pricing so premium changes
                with risk.
              </AgentBubble>
              {state.status === "quoted" || state.status === "checkout" ? (
                <>
                  {(state.status === "quoted" ? state.quote : state.quote).agentNarrative.map((line) => (
                    <AgentBubble key={line}>{line}</AgentBubble>
                  ))}
                </>
              ) : null}
              {state.status === "loading" ? (
                <AgentBubble pending>Calling the risk adapter and pricing engine…</AgentBubble>
              ) : null}
            </div>
          </section>

          <section className="panel p-6">
            <div className="flex items-center gap-3 border-b border-line pb-4">
              <span className="flex h-10 w-10 items-center justify-center border border-rain bg-rain/10 text-rain">
                <CalendarClock size={18} />
              </span>
              <div>
                <p className="kicker text-rain">Questionnaire</p>
                <h2 className="font-display text-2xl font-semibold">Coverage details</h2>
              </div>
            </div>

            <form onSubmit={handleQuote} className="mt-6 grid gap-4 md:grid-cols-2">
              {activeProduct === "rain_event" ? <RainFields /> : <FlightFields />}
              <div className="md:col-span-2">
                <button className="btn w-full sm:w-auto" disabled={state.status === "loading"} type="submit">
                  <ShieldCheck size={16} />
                  {state.status === "loading" ? "Pricing coverage…" : "Get dynamic quote"}
                </button>
              </div>
            </form>
          </section>
        </div>

        <section className="panel mt-6 p-6">
          <div className="flex items-end justify-between border-b border-line pb-3">
            <h2 className="font-display text-2xl font-semibold">Quote &amp; policy packet</h2>
            <span className="kicker">{stateLabel(state.status)}</span>
          </div>
          {state.status === "idle" ? (
            <p className="mt-4 text-ink-soft">
              Choose a coverage card and submit the questionnaire to price a policy.
            </p>
          ) : null}
          {state.status === "error" ? (
            <div className="mt-5 border border-signal/40 bg-signal/5 p-4 text-sm leading-6">
              <p className="font-mono text-[0.66rem] uppercase tracking-wider text-signal">Quote unavailable</p>
              <p className="mt-1 text-ink-soft">{state.message}</p>
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
      <LocationPicker
        defaultLat={Number(defaultRain.latitude)}
        defaultLng={Number(defaultRain.longitude)}
        defaultLocationName={defaultRain.locationName}
      />
      <Field name="eventStart" label="Event start" defaultValue={defaultRain.eventStart} type="datetime-local" />
      <Field name="eventEnd" label="Event end" defaultValue={defaultRain.eventEnd} type="datetime-local" />
      <CoverageAmountField defaultValue={defaultRain.desiredPayout} options={rainCoverageAmounts} />
      <DeductibleField defaultValue={defaultRain.deductible} />
    </>
  );
}

function FlightFields() {
  const [flight, setFlight] = useState({
    airline: defaultFlight.airline,
    flightNumber: defaultFlight.flightNumber,
    originAirport: defaultFlight.originAirport,
    destinationAirport: defaultFlight.destinationAirport,
    departureTime: defaultFlight.departureTime,
    arrivalTime: defaultFlight.arrivalTime
  });
  const [lookupDate, setLookupDate] = useState(defaultFlight.departureTime.slice(0, 10));
  const [lookupState, setLookupState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "results"; results: FlightLookupResult[] }
    | { status: "selected"; result: FlightLookupResult }
    | { status: "empty" }
    | { status: "error"; message: string }
  >({ status: "idle" });

  function updateFlightField(field: keyof typeof flight, value: string) {
    setFlight((current) => ({ ...current, [field]: value }));
    setLookupState((current) => (current.status === "loading" ? current : { status: "idle" }));
  }

  async function lookupFlight() {
    setLookupState({ status: "loading" });
    try {
      const params = new URLSearchParams({ flightNumber: flight.flightNumber, date: lookupDate });
      const response = await fetch(`/api/flights/lookup?${params}`);
      const data = (await response.json()) as { results?: FlightLookupResult[]; message?: string };
      if (!response.ok) throw new Error(data.message ?? "Unable to look up this flight.");
      const results = data.results ?? [];
      if (results.length === 0) {
        setLookupState({ status: "empty" });
        return;
      }
      if (results.length === 1) {
        selectFlight(results[0]);
        return;
      }
      setLookupState({ status: "results", results });
    } catch (error) {
      setLookupState({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to look up this flight."
      });
    }
  }

  function selectFlight(result: FlightLookupResult) {
    setFlight({
      airline: result.airline,
      flightNumber: result.flightNumber,
      originAirport: result.originAirport,
      destinationAirport: result.destinationAirport,
      departureTime: toDateTimeLocal(result.departureTime),
      arrivalTime: toDateTimeLocal(result.arrivalTime)
    });
    setLookupState({ status: "selected", result });
  }

  return (
    <>
      <FlightFormSection
        number="01"
        title="Traveller"
        description="Who is purchasing the protection and who is covered?"
      />
      <Field
        name="customerName"
        label="Policyholder name"
        defaultValue={defaultFlight.customerName}
        autoComplete="name"
        required
      />
      <Field
        name="passengerName"
        label="Covered passenger"
        defaultValue={defaultFlight.passengerName}
        helperText="Enter the name shown on the booking."
        required
      />

      <FlightFormSection
        number="02"
        title="Flight"
        description="Enter the flight number and departure date; AeroDataBox will fill the itinerary."
      />
      <Field
        name="flightNumber"
        label="Flight number"
        value={flight.flightNumber}
        onChange={(value) => updateFlightField("flightNumber", value.toUpperCase())}
        helperText="Include the airline code, for example AC101."
        placeholder="AC101"
        maxLength={7}
        pattern="[A-Za-z0-9 ]{3,7}"
        inputClassName="uppercase"
        required
      />
      <Field
        name="flightLookupDate"
        label="Departure date"
        value={lookupDate}
        onChange={(value) => {
          setLookupDate(value);
          setLookupState((current) => (current.status === "loading" ? current : { status: "idle" }));
        }}
        type="date"
        helperText="Use the departure date at the origin airport."
        required
      />

      <div className="md:col-span-2">
        <button
          className="btn-ghost w-full sm:w-auto"
          type="button"
          disabled={lookupState.status === "loading"}
          onClick={() => void lookupFlight()}
        >
          {lookupState.status === "loading" ? "Finding flight…" : "Find flight details"}
        </button>
        {lookupState.status === "empty" ? (
          <p className="mt-2 text-xs text-signal" role="status">
            No matching flight was found. Check the number and date, or enter the itinerary manually below.
          </p>
        ) : null}
        {lookupState.status === "error" ? (
          <p className="mt-2 text-xs text-signal" role="alert">
            {lookupState.message} You can still enter the itinerary manually.
          </p>
        ) : null}
        {lookupState.status === "selected" ? (
          <p className="mt-2 border-l-2 border-mint bg-mint/5 px-3 py-2 text-xs text-ink-soft" role="status">
            {lookupState.result.flightNumber} selected · {lookupState.result.originAirport} →{" "}
            {lookupState.result.destinationAirport} · {lookupState.result.status}
          </p>
        ) : null}
      </div>

      {lookupState.status === "results" ? (
        <div className="grid gap-2 md:col-span-2" aria-label="Matching flights">
          {lookupState.results.map((result) => (
            <button
              key={result.id}
              type="button"
              className="border border-line bg-card px-3 py-3 text-left transition hover:border-rain hover:bg-rain/5"
              onClick={() => selectFlight(result)}
            >
              <span className="block font-mono text-sm font-semibold">
                {result.flightNumber} · {result.originAirport} → {result.destinationAirport}
              </span>
              <span className="mt-1 block text-xs text-ink-soft">
                {formatFlightSchedule(result.departureTime, result.arrivalTime)} · {result.status}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <Field
        name="airline"
        label="Airline"
        value={flight.airline}
        onChange={(value) => updateFlightField("airline", value)}
        suggestions={airlineOptions}
        required
      />
      <Field
        name="originAirport"
        label="Origin"
        value={flight.originAirport}
        onChange={(value) => updateFlightField("originAirport", value.toUpperCase())}
        suggestions={airportOptions}
        maxLength={3}
        pattern="[A-Za-z]{3}"
        inputClassName="uppercase"
        required
      />
      <Field
        name="destinationAirport"
        label="Destination"
        value={flight.destinationAirport}
        onChange={(value) => updateFlightField("destinationAirport", value.toUpperCase())}
        suggestions={airportOptions}
        maxLength={3}
        pattern="[A-Za-z]{3}"
        inputClassName="uppercase"
        required
      />

      <FlightFormSection
        number="03"
        title="Schedule"
        description="Use the local times printed on the itinerary."
      />
      <Field
        name="departureTime"
        label="Scheduled departure"
        value={flight.departureTime}
        onChange={(value) => updateFlightField("departureTime", value)}
        type="datetime-local"
        helperText="Local time at the origin airport."
        required
      />
      <Field
        name="arrivalTime"
        label="Scheduled arrival"
        value={flight.arrivalTime}
        onChange={(value) => updateFlightField("arrivalTime", value)}
        type="datetime-local"
        helperText="Local time at the destination airport."
        required
      />

      <FlightFormSection
        number="04"
        title="Protection"
        description="Choose the benefit and deductible that fit this trip."
      />
      <CoverageAmountField defaultValue={defaultFlight.desiredPayout} options={flightCoverageAmounts} />
      <DeductibleField defaultValue={defaultFlight.deductible} />
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
    <div className="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
      <div className="quiet p-5">
        <p className="kicker">Dynamic price</p>
        <div className="mt-4 grid grid-cols-2 gap-px border border-line bg-line sm:grid-cols-5">
          <Metric label="Premium" value={`$${quote.policy.premium.amount}`} />
          <Metric label="Coverage" value={`$${quote.policy.coverageAmount?.amount ?? quote.policy.payout.amount}`} />
          <Metric label="Deductible" value={`$${quote.policy.deductible?.amount ?? 0}`} />
          <Metric label="Net payout" value={`$${quote.policy.payout.amount}`} />
          <Metric label="Risk" value={`${quote.risk.score}/100`} />
        </div>
        <div className="mt-4 border border-mint/40 bg-card p-4">
          <p className="font-mono text-[0.66rem] uppercase tracking-wider text-mint">{quote.risk.sourceLabel}</p>
          <p className="mt-1 break-all font-mono text-xs text-ink-soft">{quote.risk.source}</p>
          <p className="mt-3 text-sm text-ink">
            {quote.risk.observedMetric.label}:{" "}
            <strong className="font-mono">{quote.risk.observedMetric.value}</strong>
          </p>
          <ul className="mt-3 space-y-1.5 text-sm leading-6 text-ink-soft">
            {quote.risk.factors.map((factor) => (
              <li key={factor} className="flex gap-2">
                <span className="text-mint">›</span>
                {factor}
              </li>
            ))}
          </ul>
        </div>
        <ApiTelemetryPanel risk={quote.risk} />
        {checkoutState.status === "quoted" ? (
          <button
            className="btn mt-5 w-full border-mint bg-mint hover:border-rain hover:bg-rain"
            type="button"
            onClick={onCreateCheckout}
          >
            <ShieldCheck size={16} />
            Create Stripe checkout
          </button>
        ) : (
          <div className="mt-5 border border-mint/40 bg-mint/10 p-4">
            <p className="font-mono text-[0.66rem] uppercase tracking-wider text-mint">
              Stripe checkout session created
            </p>
            <p className="mt-2 break-all font-mono text-xs text-ink-soft">{checkoutState.checkoutId}</p>
            <a className="btn mt-4 w-full border-mint bg-mint hover:border-rain hover:bg-rain" href={checkoutState.checkoutUrl}>
              Open Stripe checkout
            </a>
          </div>
        )}
      </div>

      <div className="relative border border-ink bg-card p-5 shadow-riso">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <p className="kicker">Policy packet</p>
          <span className="tag text-rain">{quote.packet.certificateId}</span>
        </div>
        <h3 className="mt-4 font-display text-2xl font-semibold">{quote.packet.title}</h3>
        <dl className="mt-4 divide-y divide-line border-y border-line">
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
    <div className="mt-4 border border-rain/30 bg-rain/5 p-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center border border-rain bg-card text-rain">
          <Activity size={16} />
        </span>
        <div>
          <p className="font-mono text-[0.62rem] uppercase tracking-wider text-ink-soft">API call telemetry</p>
          <p className="font-mono text-sm font-semibold text-rain">{risk.apiCall.toolName}</p>
        </div>
      </div>
      <div className="mt-3 grid gap-px border border-line bg-line md:grid-cols-3">
        <TelemetryMetric label="Method" value={risk.apiCall.method} />
        <TelemetryMetric label="Status" value={formatApiStatus(risk.apiCall.status)} />
        <TelemetryMetric label="Latency" value={`${risk.apiCall.latencyMs} ms`} />
      </div>
      <p className="mt-3 text-sm leading-6 text-ink-soft">{risk.apiCall.purpose}</p>
      <p className="mt-2 break-all font-mono text-xs text-ink-soft/80">{risk.apiCall.endpoint}</p>
      <p className="mt-1 font-mono text-[0.66rem] text-ink-soft/70">
        Called at {new Date(risk.apiCall.calledAt).toLocaleString()}
      </p>
    </div>
  );
}

function TelemetryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-3">
      <p className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-soft">{label}</p>
      <p className="mt-1 font-mono text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function AgentBubble({ children, pending = false }: { children: ReactNode; pending?: boolean }) {
  return (
    <div
      className={`border-l-2 px-3 py-2 text-sm leading-6 ${
        pending ? "animate-pulse border-rain bg-rain/5 text-rain" : "border-mint bg-paper/50 text-ink-soft"
      }`}
    >
      {children}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-3 text-center">
      <p className="font-mono text-[0.6rem] uppercase tracking-wider text-ink-soft">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold">{value}</p>
    </div>
  );
}

function formatApiStatus(status: RiskAssessment["apiCall"]["status"]): string {
  if (status === "success") return "Live success";
  if (status === "fallback") return "Demo fallback";
  return "Simulated";
}

function stateLabel(status: QuoteState["status"]): string {
  if (status === "loading") return "Pricing…";
  if (status === "quoted") return "Quoted";
  if (status === "checkout") return "Checkout ready";
  if (status === "error") return "Error";
  return "Awaiting input";
}

function PacketRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 py-2.5">
      <dt className="font-mono text-[0.66rem] uppercase tracking-wider text-ink-soft">{label}</dt>
      <dd className="text-sm text-ink">{value}</dd>
    </div>
  );
}

function Field({
  name,
  label,
  defaultValue,
  type = "text",
  helperText,
  placeholder,
  autoComplete,
  maxLength,
  pattern,
  inputClassName,
  value,
  onChange,
  suggestions,
  required = false
}: {
  name: string;
  label: string;
  defaultValue?: string;
  type?: string;
  helperText?: string;
  placeholder?: string;
  autoComplete?: string;
  maxLength?: number;
  pattern?: string;
  inputClassName?: string;
  value?: string;
  onChange?: (value: string) => void;
  suggestions?: Array<{ value: string; label: string }>;
  required?: boolean;
}) {
  const helperId = helperText ? `${name}-help` : undefined;
  const listId = suggestions ? `${name}-suggestions` : undefined;
  return (
    <label className="block">
      <span className="font-mono text-[0.66rem] uppercase tracking-wider text-ink-soft">{label}</span>
      <input
        className={`field-input ${inputClassName ?? ""}`}
        name={name}
        type={type}
        {...(value === undefined
          ? { defaultValue }
          : { value, onChange: (event) => onChange?.(event.target.value) })}
        placeholder={placeholder}
        autoComplete={autoComplete}
        maxLength={maxLength}
        pattern={pattern}
        list={listId}
        required={required}
        aria-describedby={helperId}
      />
      {suggestions ? (
        <datalist id={listId}>
          {suggestions.map((suggestion) => (
            <option key={suggestion.value} value={suggestion.value}>
              {suggestion.label}
            </option>
          ))}
        </datalist>
      ) : null}
      {helperText ? (
        <span id={helperId} className="mt-1 block text-xs leading-5 text-ink-soft">
          {helperText}
        </span>
      ) : null}
    </label>
  );
}

function FlightFormSection({
  number,
  title,
  description
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mt-2 border-t border-line pt-3 md:col-span-2 first:mt-0">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[0.62rem] font-semibold text-rain">{number}</span>
        <h3 className="font-display text-lg font-semibold">{title}</h3>
      </div>
      <p className="mt-1 text-xs leading-5 text-ink-soft">{description}</p>
    </div>
  );
}

function CoverageAmountField({ defaultValue, options }: { defaultValue: string; options: string[] }) {
  return (
    <label className="block">
      <span className="font-mono text-[0.66rem] uppercase tracking-wider text-ink-soft">Coverage amount</span>
      <select className="field-input" name="desiredPayout" defaultValue={defaultValue}>
        {options.map((amount) => (
          <option key={amount} value={amount}>
            ${Number(amount).toLocaleString("en-US")}
          </option>
        ))}
      </select>
      <span className="mt-1 block text-xs leading-5 text-ink-soft">
        Maximum benefit before the deductible.
      </span>
    </label>
  );
}

function DeductibleField({ defaultValue }: { defaultValue: string }) {
  return (
    <label className="block">
      <span className="font-mono text-[0.66rem] uppercase tracking-wider text-ink-soft">Deductible</span>
      <select className="field-input" name="deductible" defaultValue={defaultValue}>
        {deductibleAmounts.map((amount) => (
          <option key={amount} value={amount}>
            ${amount}
          </option>
        ))}
      </select>
      <span className="mt-1 block text-xs leading-5 text-ink-soft">
        Subtracted from the payout when the trigger occurs.
      </span>
    </label>
  );
}

function CoverageAmountField({ defaultValue, options }: { defaultValue: string; options: string[] }) {
  return (
    <label className="block">
      <span className="font-mono text-[0.66rem] uppercase tracking-wider text-ink-soft">Coverage amount</span>
      <select className="field-input" name="desiredPayout" defaultValue={defaultValue}>
        {options.map((amount) => (
          <option key={amount} value={amount}>
            ${Number(amount).toLocaleString("en-US")}
          </option>
        ))}
      </select>
      <span className="mt-1 block text-xs leading-5 text-ink-soft">
        Maximum benefit before the deductible.
      </span>
    </label>
  );
}

function DeductibleField({ defaultValue }: { defaultValue: string }) {
  return (
    <label className="block">
      <span className="font-mono text-[0.66rem] uppercase tracking-wider text-ink-soft">Deductible</span>
      <select className="field-input" name="deductible" defaultValue={defaultValue}>
        {deductibleAmounts.map((amount) => (
          <option key={amount} value={amount}>
            ${amount}
          </option>
        ))}
      </select>
      <span className="mt-1 block text-xs leading-5 text-ink-soft">
        Subtracted from the payout when the trigger occurs.
      </span>
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
    deductible: { amount: readNumber(form, "deductible"), currency: "USD" }
  };
}

function buildFlightPayload(form: FormData): FlightPayload {
  return {
    productId: "flight_delay",
    customerName: readString(form, "customerName"),
    passengerName: readString(form, "passengerName"),
    airline: readString(form, "airline"),
    flightNumber: readString(form, "flightNumber").replace(/\s+/g, "").toUpperCase(),
    originAirport: readString(form, "originAirport").toUpperCase(),
    destinationAirport: readString(form, "destinationAirport").toUpperCase(),
    departureTime: readString(form, "departureTime"),
    arrivalTime: readString(form, "arrivalTime"),
    desiredPayout: { amount: readNumber(form, "desiredPayout"), currency: "USD" },
    deductible: { amount: readNumber(form, "deductible"), currency: "USD" }
  };
}

function readString(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function readNumber(form: FormData, name: string): number {
  return Number(form.get(name));
}

function toDateTimeLocal(value: string): string {
  return value.replace(" ", "T").slice(0, 16);
}

function formatFlightSchedule(departure: string, arrival: string): string {
  return `${toDateTimeLocal(departure).replace("T", " ")} → ${toDateTimeLocal(arrival).replace("T", " ")}`;
}
