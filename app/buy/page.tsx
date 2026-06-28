"use client";

import type { FormEvent } from "react";
import { useEffect, useReducer, useState } from "react";
import { Activity, CalendarClock, CloudRain, Plane, ShieldCheck } from "lucide-react";
import dynamic from "next/dynamic";
import type { FlightLookupResult } from "@/lib/aerodatabox";
import { estimatePremiumRange } from "@/lib/premium-pricing";
import { dynamicQuoteReducer } from "@/components/buy-flow";
import { AgentIntake } from "@/components/AgentIntake";

const LocationPicker = dynamic(() => import("@/components/LocationPicker"), {
  ssr: false,
  loading: () => <div className="h-64 animate-pulse border border-line md:col-span-2" />
});

type ProductId = "rain_event" | "flight_delay";

type Money = {
  amount: number;
  currency: "USD";
};

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
  desiredPayout: "500",
  deductible: "0"
};

const defaultFlight = {
  customerName: "John Doe",
  passengerName: "John Doe",
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
  const [state, dispatch] = useReducer(dynamicQuoteReducer, { phase: "idle" });
  const [premiumEstimate, setPremiumEstimate] = useState(() => defaultPremiumEstimate("rain_event"));
  const [buyError, setBuyError] = useState<string | undefined>();
  const [isBuying, setIsBuying] = useState(false);
  const [terms, setTerms] = useState<RainPayload | FlightPayload | undefined>();

  const selectedProduct = products.find((product) => product.id === activeProduct) ?? products[0];
  const pollQuoteId = state.phase === "intake" ? state.quoteId : undefined;

  async function handleDynamicQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = activeProduct === "rain_event" ? buildRainPayload(form) : buildFlightPayload(form);
    setTerms(payload);
    try {
      const res = await fetch("/api/agent/coverage-request", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pricing: "dynamic", ...payload })
      });
      const data = await res.json();
      if (!res.ok || !data.accepted) { dispatch({ type: "failed", message: data.message ?? "Could not start pricing." }); return; }
      dispatch({ type: "requested", quoteId: data.quoteId, baseline: data.baseline ? { premium: data.baseline.premium } : undefined });
    } catch { dispatch({ type: "failed", message: "Unable to reach the quote service." }); }
  }

  useEffect(() => {
    if (state.phase !== "intake") return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/ops/quote-status/${state.quoteId}`);
        if (!res.ok) return;
        const status = await res.json();
        dispatch({ type: "statusPolled", status });
      } catch { /* keep polling */ }
    }, 2000);
    return () => clearInterval(id);
  }, [state.phase, pollQuoteId]);

  async function buyDynamic() {
    if (state.phase !== "priced") return;
    setBuyError(undefined);
    setIsBuying(true);
    try {
      const res = await fetch(`/api/buy/confirm-dynamic/${state.quoteId}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maximumPremium: { amount: state.premium.amount, currency: "USD" } })
      });
      const data = await res.json();
      if (data.accepted && data.checkout?.url) {
        window.location.assign(data.checkout.url);
      } else {
        setBuyError(data.message ?? "Unable to start checkout.");
        setIsBuying(false);
      }
    } catch {
      setBuyError("Network error — unable to reach the checkout service.");
      setIsBuying(false);
    }
  }

  return (
    <main className="px-4 py-6 text-ink sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex items-center gap-3 border-y border-signal/40 bg-signal/5 px-3 py-2 font-mono text-[0.66rem] uppercase tracking-wider text-signal">
          <span className="border border-signal px-1.5 py-0.5">Notice</span>
          <span className="text-ink-soft">
            Hackathon demo only — Stripe test mode. No real insurance, coverage, or legally binding
            payouts.
          </span>
        </div>

        {/* Section header */}
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b-2 border-ink pb-2">
          <div>
            <p className="kicker text-rain">Coverage catalog</p>
            <h1 className="mt-1 font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              Choose parametric protection
            </h1>
          </div>
        </div>

        {/* Product selector */}
        <div className="grid gap-px border border-line bg-line md:grid-cols-2">
          {products.map((product) => {
            const Icon = product.icon;
            const selected = product.id === activeProduct;
            return (
              <button
                key={product.id}
                className={`p-4 text-left transition-colors ${
                  selected ? "bg-rain text-card" : "bg-card hover:bg-paper/60"
                }`}
                type="button"
                onClick={() => {
                  setActiveProduct(product.id);
                  setPremiumEstimate(defaultPremiumEstimate(product.id));
                  dispatch({ type: "reset" });
                  setTerms(undefined);
                  setBuyError(undefined);
                  setIsBuying(false);
                }}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center border ${
                      selected ? "border-card/60 bg-card/15 text-card" : "border-ink bg-rain/10 text-rain"
                    }`}
                  >
                    <Icon size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-lg font-semibold leading-tight">{product.name}</span>
                    <span className="mt-1 flex flex-wrap gap-2 font-mono text-[0.62rem] font-semibold uppercase tracking-wider">
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

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
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

            <form
              onSubmit={handleDynamicQuote}
              onChange={(event) => setPremiumEstimate(premiumEstimateFromForm(activeProduct, event.currentTarget))}
              className="mt-6 grid gap-4 md:grid-cols-2"
            >
              {activeProduct === "rain_event" ? <RainFields /> : <FlightFields />}
              <div className="flex flex-col gap-3 md:col-span-2 sm:flex-row">
                <button
                  className="btn w-full"
                  disabled={state.phase === "intake"}
                  type="submit"
                >
                  <ShieldCheck size={16} /> Get Dynamic Quote
                </button>
              </div>
            </form>
          </section>

          <section className="panel reg p-6">
            <div className="flex items-center gap-3 border-b border-line pb-4">
              <span className="flex h-10 w-10 items-center justify-center border border-mint bg-mint/10 text-mint">
                <Activity size={18} />
              </span>
              <div>
                <p className="kicker text-mint">Quote</p>
                <h2 className="font-display text-2xl font-semibold">
                  {state.phase === "priced" ? "Your quote" : state.phase === "intake" ? "Live quote" : "Estimate"}
                </h2>
              </div>
            </div>

            <div className="mt-5 grid gap-5">
              {state.phase !== "error" ? (
                <div className="border border-rain/30 bg-rain/5 p-4" aria-live="polite">
                  <p className="font-mono text-[0.66rem] uppercase tracking-wider text-rain">
                    Estimated premium range
                  </p>
                  <p className="mt-1 font-display text-3xl font-semibold">
                    {premiumEstimate
                      ? `$${premiumEstimate.minimum.amount}–$${premiumEstimate.maximum.amount}`
                      : "Complete valid coverage terms"}
                  </p>
                  {state.phase === "idle" ? (
                    <p className="mt-2 text-xs leading-5 text-ink-soft">
                      Submit the questionnaire. Our Underwriting agents research live data for the risk
                      factors and arrive at your final premium.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {state.phase === "intake" || state.phase === "priced" ? (
                <div className="border-t border-line pt-5">
                  <p className="kicker">Live agent progress</p>
                  <div className="mt-2">
                    <AgentIntake state={state} />
                  </div>
                </div>
              ) : null}

              {state.phase === "priced" ? (
                <div className="border-t border-line pt-5">
                  <p className="kicker">Final premium</p>
                  <p className="mt-2 font-display text-3xl font-semibold">${state.premium.amount} USD</p>
                  {state.citations.length > 0 ? (
                    <div className="mt-4">
                      <p className="font-mono text-[0.66rem] uppercase tracking-wider text-ink-soft">Evidence</p>
                      <ul className="mt-2 space-y-1">
                        {state.citations.map((c, i) => (
                          <li key={i} className="text-sm">
                            <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-rain underline underline-offset-2">
                              {c.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <div className="mt-5">
                    {buyError ? (
                      <div className="mb-3 border border-signal/40 bg-signal/5 p-3 text-sm leading-6" role="alert">
                        <p className="font-mono text-[0.66rem] uppercase tracking-wider text-signal">Checkout error</p>
                        <p className="mt-1 text-ink-soft">{buyError}</p>
                      </div>
                    ) : null}
                    <button
                      className="btn w-full border-mint bg-mint hover:border-rain hover:bg-rain disabled:opacity-60"
                      type="button"
                      disabled={isBuying}
                      onClick={() => void buyDynamic()}
                    >
                      <ShieldCheck size={16} />
                      {isBuying ? "Opening secure checkout…" : "Buy coverage"}
                    </button>
                    <p className="mt-2 text-center font-mono text-[0.62rem] uppercase tracking-wider text-ink-soft">
                      Secure Stripe checkout · Coverage activates after verified payment
                    </p>
                  </div>
                </div>
              ) : null}

              {state.phase === "error" ? (
                <div className="border border-signal/40 bg-signal/5 p-4 text-sm leading-6">
                  <p className="font-mono text-[0.66rem] uppercase tracking-wider text-signal">Quote unavailable</p>
                  <p className="mt-1 text-ink-soft">{state.message}</p>
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <section className="panel mt-6 p-6">
          <div className="flex items-end justify-between border-b border-line pb-3">
            <h2 className="font-display text-2xl font-semibold">Policy Packet</h2>
            <span className="kicker">
              {state.phase === "idle" ? "Awaiting input" : state.phase === "intake" ? "Pricing…" : state.phase === "priced" ? "Quoted" : "Error"}
            </span>
          </div>
          {state.phase === "idle" ? (
            <p className="mt-4 text-ink-soft">
              Choose a coverage card and submit the questionnaire to generate a specimen certificate.
            </p>
          ) : null}
          {state.phase === "intake" ? (
            <p className="mt-4 text-ink-soft">
              Pricing in progress — follow the live steps on the right. Your specimen certificate
              appears here once the operator submits a quote.
            </p>
          ) : null}
          {state.phase === "priced" ? (
            <div className="mt-4">
              <SpecimenCertificate
                terms={terms}
                product={selectedProduct}
                premium={state.premium}
                quoteId={state.quoteId}
              />
            </div>
          ) : null}
          {state.phase === "error" ? (
            <p className="mt-4 text-ink-soft">No certificate — pricing did not complete.</p>
          ) : null}
        </section>
      </div>
    </main>
  );
}

function RainFields() {
  const [eventWindow, setEventWindow] = useState({ start: "", end: "" });

  useEffect(() => {
    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(11, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    setEventWindow({
      start: toLocalDateTimeInput(start),
      end: toLocalDateTimeInput(end)
    });
  }, []);

  return (
    <>
      <FormSection
        number="01"
        title="Organizer"
        description="Who is purchasing the protection?"
      />
      <Field name="customerName" label="Customer" defaultValue={defaultRain.customerName} />
      <Field name="eventName" label="Event" defaultValue={defaultRain.eventName} />

      <FormSection
        number="02"
        title="Event"
        description="Where and when should rainfall be measured?"
      />
      <LocationPicker
        defaultLat={Number(defaultRain.latitude)}
        defaultLng={Number(defaultRain.longitude)}
        defaultLocationName={defaultRain.locationName}
      />
      <Field
        name="eventStart"
        label="Event start"
        value={eventWindow.start}
        onChange={(start) => setEventWindow((current) => ({ ...current, start }))}
        type="datetime-local"
        required
      />
      <Field
        name="eventEnd"
        label="Event end"
        value={eventWindow.end}
        onChange={(end) => setEventWindow((current) => ({ ...current, end }))}
        type="datetime-local"
        required
      />

      <FormSection
        number="03"
        title="Protection"
        description="Choose the benefit and deductible for this event."
      />
      <div className="grid gap-4 md:col-span-2 md:grid-cols-2">
        <CoverageAmountField defaultValue={defaultRain.desiredPayout} options={rainCoverageAmounts} />
        <DeductibleField defaultValue={defaultRain.deductible} />
      </div>
    </>
  );
}

function FlightFields() {
  const [flight, setFlight] = useState({
    airline: "",
    flightNumber: defaultFlight.flightNumber,
    originAirport: "",
    destinationAirport: "",
    departureTime: "",
    arrivalTime: "",
    status: "",
    originName: "",
    destinationName: ""
  });
  const [lookupDate, setLookupDate] = useState(defaultFlight.departureTime.slice(0, 10));
  const [manualEntry, setManualEntry] = useState(false);

  useEffect(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setLookupDate(toLocalDateInput(tomorrow));
  }, []);
  const [lookupState, setLookupState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "results"; results: FlightLookupResult[] }
    | { status: "selected"; result: FlightLookupResult }
    | { status: "empty" }
    | { status: "error"; message: string }
  >({ status: "idle" });

  function updateFlightField(field: keyof typeof flight, value: string) {
    setFlight((current) => {
      const next = { ...current, [field]: value };
      if (field === "originAirport") next.originName = "";
      if (field === "destinationAirport") next.destinationName = "";
      return next;
    });
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
      arrivalTime: toDateTimeLocal(result.arrivalTime),
      status: result.status,
      originName: result.originName,
      destinationName: result.destinationName
    });
    setManualEntry(false);
    setLookupState({ status: "selected", result });
  }

  return (
    <>
      <FormSection
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

      <FormSection
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
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            className="btn-ghost w-full sm:w-auto"
            type="button"
            disabled={lookupState.status === "loading"}
            onClick={() => void lookupFlight()}
          >
            {lookupState.status === "loading" ? "Finding flight…" : "Find flight details"}
          </button>
          <button
            className="btn-ghost w-full sm:w-auto"
            type="button"
            aria-pressed={manualEntry}
            onClick={() => setManualEntry((current) => !current)}
          >
            {manualEntry ? "Lock manual entry" : "Enter manually"}
          </button>
        </div>
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
        suggestions={manualEntry ? airlineOptions : undefined}
        readOnly={!manualEntry}
        required
      />
      <Field
        name="flightStatus"
        label="Flight status"
        value={flight.status}
        readOnly
      />
      {manualEntry ? (
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
      ) : (
        <>
          <input type="hidden" name="originAirport" value={flight.originAirport} />
          <Field
            name="originAirportLabel"
            label="Origin"
            value={flight.originName ? `${flight.originAirport} - ${flight.originName}` : flight.originAirport}
            readOnly
          />
        </>
      )}
      {manualEntry ? (
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
      ) : (
        <>
          <input type="hidden" name="destinationAirport" value={flight.destinationAirport} />
          <Field
            name="destinationAirportLabel"
            label="Destination"
            value={
              flight.destinationName
                ? `${flight.destinationAirport} - ${flight.destinationName}`
                : flight.destinationAirport
            }
            readOnly
          />
        </>
      )}

      <Field
        name="departureTime"
        label="Scheduled departure"
        value={flight.departureTime}
        onChange={(value) => updateFlightField("departureTime", value)}
        type="datetime-local"
        helperText="Local time at the origin airport."
        readOnly={!manualEntry}
        required
      />
      <Field
        name="arrivalTime"
        label="Scheduled arrival"
        value={flight.arrivalTime}
        onChange={(value) => updateFlightField("arrivalTime", value)}
        type="datetime-local"
        helperText="Local time at the destination airport."
        readOnly={!manualEntry}
        required
      />

      <FormSection
        number="03"
        title="Protection"
        description="Choose the benefit and deductible that fit this trip."
      />
      <div className="grid gap-4 md:col-span-2 md:grid-cols-2">
        <CoverageAmountField defaultValue={defaultFlight.desiredPayout} options={flightCoverageAmounts} />
        <DeductibleField defaultValue={defaultFlight.deductible} />
      </div>
    </>
  );
}

function SpecimenCertificate({
  terms,
  product,
  premium,
  quoteId
}: {
  terms: RainPayload | FlightPayload | undefined;
  product: (typeof products)[number];
  premium: Money;
  quoteId: string;
}) {
  return (
    <div className="panel relative overflow-hidden p-5">
      <span className="pointer-events-none absolute right-4 top-4 font-mono text-[0.6rem] uppercase tracking-widest text-ink-soft/60">
        Specimen
      </span>
      <p className="kicker">Specimen certificate</p>
      <h3 className="mt-2 font-display text-xl font-semibold">{product.name}</h3>
      <p className="mt-1 font-mono text-[0.66rem] uppercase tracking-wider text-ink-soft">Ref {quoteId}</p>

      <dl className="mt-4 grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {terms ? <CertificateTerms terms={terms} /> : null}
        <CertRow label="Trigger" value={product.trigger} />
        <CertRow label="Data source" value={product.api} />
        {terms ? <CertRow label="Coverage payout" value={`$${terms.desiredPayout.amount} USD`} /> : null}
        {terms ? <CertRow label="Deductible" value={`$${terms.deductible.amount} USD`} /> : null}
        <CertRow label="Premium" value={`$${premium.amount} USD`} />
      </dl>

      <p className="mt-4 border-t border-line pt-3 text-xs leading-5 text-ink-soft">
        Specimen only — not a binding policy. Coverage is issued and the certificate finalized after
        verified Stripe payment.
      </p>
    </div>
  );
}

function CertificateTerms({ terms }: { terms: RainPayload | FlightPayload }) {
  if (terms.productId === "rain_event") {
    return (
      <>
        <CertRow label="Insured" value={terms.customerName} />
        <CertRow label="Event" value={terms.eventName} />
        <CertRow label="Location" value={terms.locationName} />
        <CertRow
          label="Coverage window"
          value={`${formatWhen(terms.eventStart)} → ${formatWhen(terms.eventEnd)}`}
        />
      </>
    );
  }
  return (
    <>
      <CertRow label="Insured" value={terms.passengerName} />
      <CertRow label="Flight" value={`${terms.airline} ${terms.flightNumber}`} />
      <CertRow label="Route" value={`${terms.originAirport} → ${terms.destinationAirport}`} />
      <CertRow label="Departure" value={formatWhen(terms.departureTime)} />
      <CertRow label="Arrival" value={formatWhen(terms.arrivalTime)} />
    </>
  );
}

function CertRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[0.62rem] uppercase tracking-wider text-ink-soft">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
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
  required = false,
  readOnly = false
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
  readOnly?: boolean;
}) {
  const helperId = helperText ? `${name}-help` : undefined;
  const listId = suggestions ? `${name}-suggestions` : undefined;
  return (
    <label className="block">
      <span className="font-mono text-[0.66rem] uppercase tracking-wider text-ink-soft">{label}</span>
      <input
        className={`field-input ${readOnly ? "field-readonly" : ""} ${inputClassName ?? ""}`}
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
        readOnly={readOnly}
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

function FormSection({
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

function defaultPremiumEstimate(productId: ProductId) {
  if (productId === "rain_event") {
    return estimatePremiumRange({
      productId,
      coverageAmount: Number(defaultRain.desiredPayout),
      deductibleAmount: Number(defaultRain.deductible),
      durationHours: 1
    });
  }

  return estimatePremiumRange({
    productId,
    coverageAmount: Number(defaultFlight.desiredPayout),
    deductibleAmount: Number(defaultFlight.deductible),
    durationHours: durationHours(defaultFlight.departureTime, defaultFlight.arrivalTime)
  });
}

function premiumEstimateFromForm(productId: ProductId, form: HTMLFormElement) {
  const data = new FormData(form);
  const start = productId === "rain_event" ? readString(data, "eventStart") : readString(data, "departureTime");
  const end = productId === "rain_event" ? readString(data, "eventEnd") : readString(data, "arrivalTime");

  return estimatePremiumRange({
    productId,
    coverageAmount: readNumber(data, "desiredPayout"),
    deductibleAmount: readNumber(data, "deductible"),
    durationHours: durationHours(start, end)
  });
}

function durationHours(start: string, end: string): number {
  return (new Date(end).getTime() - new Date(start).getTime()) / 3_600_000;
}

function toDateTimeLocal(value: string): string {
  return value.replace(" ", "T").slice(0, 16);
}

function toLocalDateTimeInput(value: Date): string {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function toLocalDateInput(value: Date): string {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function formatFlightSchedule(departure: string, arrival: string): string {
  return `${toDateTimeLocal(departure).replace("T", " ")} → ${toDateTimeLocal(arrival).replace("T", " ")}`;
}
