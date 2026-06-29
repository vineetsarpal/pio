# PIO

PIO is a hackathon prototype for automated, evidence-grounded parametric coverage operations. It pairs an agent operator (Gauge) with deterministic underwriting and settlement logic so that money movement and claim approval are always controlled by typed functions rather than free-form model output.

**Demo/compliance note:** PIO is not a live insurance product and does not issue real coverage or legally binding payouts. The reference flow uses Stripe test mode to demonstrate premium collection, payout workflow boundaries, and auditability for hackathon purposes.

## Demo

▶️ **[Watch the demo](https://x.com/VineetSarpal/status/2071587335901175869)**

<!--
For native inline playback, drag the demo .mp4/.mov directly into this section
using GitHub's web editor (https://github.com/vineetsarpal/pio/edit/main/README.md).
GitHub uploads it to its CDN and renders an inline player. Size limit: 10 MB
(100 MB with GitHub Pro). The committed link above is the fallback.
-->

PIO quotes two parametric products, each with a deterministic trigger:

- **Rain event protection** — fixed payout when rainfall crosses the covered trigger (rainfall total > 5 mm over the event window).
- **Flight delay protection** — fixed payout when arrival delay exceeds the covered threshold (> 90 minutes).

For every policy PIO will:

- price a premium from coverage amount, product risk band, and window length (dynamic, not a flat rate)
- issue a policy only after premium payment is verified by a Stripe webhook
- monitor observations against the deterministic policy trigger
- evaluate the trigger with deterministic code
- initiate a Stripe payout only after deterministic claim approval
- produce a grounded audit report and agent action log for every policy

## Getting started

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`. The key surfaces are:

- `/` — product landing page
- `/buy` — customer buy flow with a live agent-intake panel (dynamic quote → checkout)
- `/buy/success` — Stripe return page that polls verified policy activation
- `/agents` — human-readable agent discovery page generated from the Agent Card
- `/ops` — operator dashboard: live pricing queue + manual review queue
- `/ops/[policyId]` — per-policy operator detail and settlement view
- `/.well-known/agent-card.json` — A2A-style discovery document for buyer agents

### Database (Neon Postgres)

The money path (quote → checkout → webhook → settlement) is durable: it persists
to Neon Postgres via the `PostgresPolicyStore`. The runtime routes require
`NEON_POSTGRES_CONNECTION_STRING` and fail loudly if it is missing — they never
silently fall back to an ephemeral in-memory store.

`NEON_POSTGRES_CONNECTION_STRING` is provisioned and managed by the Stripe
Projects CLI in `.env` (loaded automatically by Next.js), so local dev needs no
extra setup. The same variable drives both the runtime store and migrations; for
production scale you can point it at the pooled `-pooler` Neon endpoint.

Apply the schema:

```bash
npm run db:migrate      # applies committed migrations
npm run db:generate     # regenerate migrations after editing lib/db/schema.ts
```

The schema is authored in `lib/db/schema.ts`; migrations are committed under
`drizzle/`. `InMemoryPolicyStore` remains as the test double — the unit suite
needs no database.

### Environment configuration

`.env.example` documents the variables you set yourself. Summary:

| Variable | Purpose |
|----------|---------|
| `NEON_POSTGRES_CONNECTION_STRING` | Durable policy store + migrations (provisioned by Stripe Projects). |
| `STRIPE_SECRET_KEY` | Stripe test-mode secret (`sk_test_` only). Enables real Checkout/PaymentIntent creation. |
| `STRIPE_WEBHOOK_SECRET` | Verifies inbound Stripe webhook signatures. |
| `NEXT_PUBLIC_APP_URL` | Base URL used for Stripe redirect/success URLs. |
| `PIO_AGENT_SEED_KEY` / `PIO_AGENT_SEED_ID` | Seeded buyer-agent identity for the `/buy` and headless purchase paths. |
| `PIO_SEED_STRIPE_CUSTOMER` / `PIO_SEED_STRIPE_PAYMENT_METHOD` | Seeded Stripe customer + vaulted test card for off-session agent purchases. |
| `PIO_OPERATOR_KEY` | Privileged operator (Gauge) key for the `/api/operator/*` surface. Must match the value the Hermes operator instance presents. |
| `PIO_POLICY_STATUS_TOKEN_SECRET` | HMAC secret for the buyer-facing `/api/buy/policy-status/[policyId]` capability token included in Stripe success URLs. |
| `AERODATABOX_RAPIDAPI_KEY` | Server-only key for flight-number / departure-date lookup. |

The operator dashboard and the deterministic core work without Stripe credentials. PIO intentionally accepts only `sk_test_` keys for the demo payment path.

## Testing

```bash
npm test
```

The test suite covers the workflow state machine, payment events, ledger consistency, operator review, audit generation, the coverage quote engine, the operator-research pricing flow, and the agent coverage adapters.

## Architecture

PIO separates deterministic insurance logic from the agent orchestration and external service adapters. Core seams:

### Deterministic core
- `lib/workflow.ts` — deterministic quote, issue, trigger, and settlement logic
- `lib/coverage-products.ts` — the canonical multi-product quote engine (`quoteCoverageProduct`) for rain and flight coverage
- `lib/premium-pricing.ts` — premium calculation from product base rate, risk-band adjustment, and window length
- `lib/state-machine.ts` — policy transition map that constrains agent tool execution
- `lib/ledger-apply.ts` — applies status-changing events to the ledger
- `lib/ledger-consistency.ts` — projection checks proving current policy rows match status-changing events
- `lib/audit.ts` — grounded audit reports derived from policy, weather/flight, and payment facts
- `lib/types.ts` — machine-readable policy, trigger, weather, settlement, and action records

### Persistence
- `lib/policy-store.ts` — source-of-truth policy ledger interface, the in-memory test-double implementation, and the `withTransaction` unit-of-work
- `lib/postgres-policy-store.ts` — durable Neon-backed `PolicyStore` (Drizzle), with DB-enforced idempotency constraints and atomic transactions
- `lib/policy-store-factory.ts` — `getPolicyStore()` for runtime routes; requires `NEON_POSTGRES_CONNECTION_STRING`, no in-memory fallback
- `lib/db/schema.ts`, `lib/db/client.ts` — Drizzle schema (JSONB-blob + key columns) and the cached neon-serverless client

### External adapters
- `lib/weather-oracle.ts` — seeded replay and Open-Meteo weather oracle adapters
- `lib/aerodatabox.ts` — AeroDataBox flight-status lookup adapter
- `lib/geocode.ts` — location lookup / reverse geocoding for the buy flow
- `lib/payment-adapter.ts` — Stripe Skills-shaped payment adapter boundary
- `lib/stripe-checkout.ts` — Stripe Checkout Session adapter
- `lib/stripe-payment-intent.ts` — off-session PaymentIntent adapter + webhook normalization
- `lib/stripe-webhook.ts` — Stripe webhook signature verification
- `lib/payment-events.ts` — immutable premium and payout event handlers

### Agent orchestration
- `lib/gauge-tools.ts` — Gauge orchestration surface for the coverage workflow and the `hermesToolManifest`
- `lib/agent-coverage.ts` — customer-owned agent coverage request, quote, and purchase-confirmation logic
- `lib/agent-purchase.ts` — headless off-session purchase (seeded agent charges a vaulted card)
- `lib/agent-seed.ts` — seeded buyer-agent identity + authentication
- `lib/operator-auth.ts`, `lib/operator-http.ts` — operator (`PIO_OPERATOR_KEY`) authentication for the `/api/operator/*` surface
- `lib/operator-research-pricing.ts` — operator-researched dynamic pricing: turns a research risk memo into a clamped, priced quote
- `lib/pricing-job.ts` — pricing-job records and progress events
- `lib/operator-settlement.ts` — operator-triggered deterministic settlement for an issued policy
- `lib/operator-review.ts` — ledger-derived queue for manual reviews and payout failures
- `lib/ops-feed.ts`, `lib/ops-view.ts` — `/ops` pricing-feed and policy view projections
- `lib/http-schemas.ts` — Zod request schemas for the HTTP API
- `lib/demo-fixtures.ts` — seeded policy, observations, and action log

### UI
- `app/page.tsx` — product landing page
- `app/buy/*` — customer buy flow + success page
- `app/agents/page.tsx` — human-readable agent discovery page rendered from the same Agent Card source as `/.well-known/agent-card.json`
- `app/ops/*` — operator dashboard (pricing queue, review queue) and per-policy detail
- `components/*` — `AgentIntake` (live pricing feed), `PricingQueue`, `LocationPicker`, and shared formatting helpers
- `app/api/*` — HTTP endpoints for quoting, agent coverage, dynamic pricing, Stripe events, and operator review

External integrations — Hermes, Stripe Skills, Open-Meteo, AeroDataBox, and model providers — sit behind adapter boundaries so they can be swapped without changing the orchestration code. Money movement and trigger approval stay inside typed deterministic functions.

### Persistence boundary

The persistence boundary is the `PolicyStore` interface over a policy ledger with `policies`, `workflowEvents`, `paymentEvents`, pricing jobs, and terminal `auditSnapshots`. Two implementations satisfy it: `InMemoryPolicyStore` (test double) and `PostgresPolicyStore` (Neon, via Drizzle). A shared conformance suite (`test/policy-store-conformance.test.ts`) runs the same scenarios against both — the Postgres store against in-process PGlite — so they behave identically.

Each table stores the full typed object as a JSONB `data` blob alongside a few extracted key columns (`id`, `policy_id`, `kind`, `reference`, `status`) that drive queries and constraints. Idempotency and the single-payout invariants are enforced by DB constraints (unique `(policy_id, kind, reference)` plus partial unique indexes for one payout request / one payout per policy) rather than read-then-check. Money-mutating operations run inside `withTransaction` so a crash or duplicate webhook cannot leave a torn write; a `runIdempotent` wrapper retries once on a uniqueness race, after which the read-check fast path returns an idempotent replay. Policy rows are kept for fast UI/API reads, while workflow events remain the audit spine. `ledgerConsistency` projects the latest status-changing workflow event and verifies that each current row matches it.

### Workflow state machine

Gauge is modeled as a policy-state-machine operator, not a free-form workflow runner. The happy path is:

```text
quote_requested -> weather_risk_checked -> policy_quoted -> premium_paid
-> policy_issued -> monitoring_active -> trigger_data_received
-> trigger_evaluated -> claim_approved -> payout_issued
```

Non-triggered claims move from `trigger_evaluated` to `not_triggered`. The payout adapter is only called after deterministic claim approval.

### Evidence policy

Weather evidence is snapshot-based. Replayed observations are treated as settlement-grade; live Open-Meteo evidence is treated as advisory until it has an immutable source URL, request params, capture timestamp, normalization version, and missing-data policy. Missing or advisory evidence fails closed into `manual_review` — never an automatic payout.

## The operator-research pricing flow

The headline flow lets the operator agent (Gauge) price a quote from live web research while PIO keeps the pricing math deterministic.

1. A buyer (the `/buy` page or a buyer agent) requests a **dynamic quote**. PIO opens a pricing job and immediately emits its own baseline stage events (`weather_api_called` → `baseline_computed`).
2. Gauge — running as a Hermes operator instance — waits for the job, performs web research, calls `report_progress` at each milestone, and submits a **research risk memo** (`submit_research_quote`).
3. PIO clamps the operator's risk score into the product's risk band, prices the policy deterministically (`priced`), and moves it to `policy_quoted`.
4. The `/buy` intake panel flips to the priced quote with cited evidence and a **Buy** button → Stripe test checkout.
5. `/ops` shows the live pricing queue (pending → priced with citation count).

PIO emits the `pio`-sourced stage events itself, so the live feed renders even if the operator skips progress reporting. See `hermes/README.md` for running the Hermes MCP server, the two role configurations (operator vs buyer), and the full demo order.

## API

The end-to-end Gauge workflow (quote → checkout → payment → monitoring →
trigger → payout → audit) is exercised in-process by `runGaugeDemoWorkflow`
(`lib/gauge-tools.ts`) and covered by the test suite; it is not exposed as a
runtime endpoint. The HTTP API surfaces the individual steps below.

### Quoting

- `POST /api/quote` — single-product rain-coverage quote for a human UI or customer-owned agent.
- `POST /api/products/quote` — multi-product quote engine (`rain_event` or `flight_delay`).
- `GET  /api/flights/lookup` — flight-number + date lookup (AeroDataBox).
- `GET  /api/geocode`, `GET /api/geocode/reverse` — location lookup for the buy form.

### Agent discovery

- `GET /.well-known/agent-card.json` — canonical A2A-style Agent Card for buyer agents.
- `GET /api/agent-card` — implementation route behind the well-known rewrite.
- `GET /agents` — human-readable companion page generated from the same `buildAgentCard` source.

The Agent Card describes the REST buyer API, not an A2A JSON-RPC server. It advertises HTTP+JSON skills for dynamic coverage requests, dynamic purchase confirmation, off-session purchase, and policy-status reads. Authenticated purchase and policy-read calls accept `x-pio-agent-key` or `Authorization: Bearer <key>`.

Request a single-product quote:

```bash
curl -X POST http://localhost:3000/api/quote \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "North Pier Pop-up Market",
    "eventName": "Saturday Harbor Market",
    "locationName": "Toronto Waterfront",
    "latitude": 43.6405,
    "longitude": -79.3764,
    "eventStart": "2026-06-20T12:00:00-04:00",
    "eventEnd": "2026-06-20T18:00:00-04:00",
    "desiredPayout": { "amount": 500, "currency": "USD" },
    "maximumPremium": { "amount": 75, "currency": "USD" }
  }'
```

### Customer-owned agent coverage

- `POST /api/agent/coverage-request` — agent requests a quote (static path).
- `POST /api/agent/coverage-request` with `pricing: "dynamic"` — opens a dynamic pricing job and returns immediately with `pricing_pending`.
- `POST /api/agent/confirm-purchase` — agent confirms a static quote.
- `POST /api/agent/confirm-dynamic-purchase` — agent confirms a priced dynamic quote (premium replayed from the stored policy; no re-quote).
- `POST /api/agent/purchase` — headless off-session purchase: seeded agent key charges its vaulted card; activation arrives via the PaymentIntent webhook.
- `GET  /api/agent/policy/[policyId]` — read a single policy's status + payment ledger (lets a headless driver confirm `policy_issued`).
- `POST /api/buy/confirm-dynamic/[quoteId]` — browser-facing buy proxy; supplies the seeded agent identity server-side so the agent key never reaches the browser.
- `GET  /api/buy/policy-status/[policyId]` — buyer-facing status poll used by `/buy/success`; accepts the signed `t` capability token or verifies the Stripe Checkout `session_id`.

The initial coverage request route is open and rate-limited so the browser buy flow can create quotes. Purchase confirmation, off-session purchase, and `/api/agent/policy/[policyId]` require the seeded buyer-agent key.

```bash
curl -X POST http://localhost:3000/api/agent/coverage-request \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "ops-agent-north-pier",
    "purchaseIntent": "buy_if_within_budget",
    "customerName": "North Pier Pop-up Market",
    "eventName": "Saturday Harbor Market",
    "locationName": "Toronto Waterfront",
    "latitude": 43.6405,
    "longitude": -79.3764,
    "eventStart": "2026-06-20T12:00:00-04:00",
    "eventEnd": "2026-06-20T18:00:00-04:00",
    "desiredPayout": { "amount": 500, "currency": "USD" },
    "maximumPremium": { "amount": 75, "currency": "USD" }
  }'
```

If the premium cap is too low, the response is rejected with `reasonCode: "premium_cap_exceeded"` and includes both the quoted premium and maximum premium. These endpoints only quote or direct checkout creation; policy issuance still requires payment verification and state-machine transitions. The confirmation endpoints use the idempotency key to replay identical confirmations or reject conflicting retries.

### Operator (Gauge) surface

All `/api/operator/*` routes require the `PIO_OPERATOR_KEY` bearer token.

- `GET  /api/operator/pricing-queue` (+ `/wait`) — pending pricing jobs; the `wait` variant long-polls for the next job.
- `POST /api/operator/quote/[quoteId]/progress` — append a research progress milestone.
- `POST /api/operator/quote/[quoteId]/price` — submit the research risk memo; PIO clamps and prices the quote.
- `POST /api/operator/policy/[policyId]/settle` — pull oracle evidence, evaluate the trigger, and request the payout on approval.
- `GET  /api/operator/review-queue` — ledger-derived manual review / payout-failure queue.

```bash
curl http://localhost:3000/api/operator/review-queue \
  -H "Authorization: Bearer $PIO_OPERATOR_KEY"
```

Operator review is derived from the ledger. Policies in `manual_review` and payment events with `payout_failed` become open queue items; clean automatic claims do not create review records.

### `/ops` live feed (unauthenticated read views)

- `GET /api/ops/pricing-feed` — pricing-queue projection for the `/ops` dashboard.
- `GET /api/ops/quote-status/[quoteId]` — per-quote status for the buy-page intake panel.

### Stripe payment events

PIO has two premium-collection paths; both normalize into the same immutable `premium_collected` payment event before the policy is issued:

- `POST /api/stripe/create-checkout` — create a test-mode Checkout Session (browser flow).
- `POST /api/stripe/webhook` — verified `checkout.session.completed` → `premium_collected`.
- `POST /api/stripe/payment-intent` — verified off-session `payment_intent.succeeded`/`.failed` (headless agent flow).
- `POST /api/stripe/payout-completed` / `POST /api/stripe/payout-failed` — payout outcome events.

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

Stripe sends a signed event to the webhook. PIO verifies the signature, normalizes it into an immutable payment event, and activates the policy tied to the checkout/payment-intent id. The success redirect is **not** treated as payment truth; policy activation still depends on the immutable webhook event boundary.

```bash
curl -X POST http://localhost:3000/api/stripe/payout-completed \
  -H "Content-Type: application/json" \
  -d '{
    "providerEventId": "evt_test_pio_payout_completed_0001",
    "requestId": "payout-request-pio-pol-2026-0001",
    "payoutReference": "po_test_pio_claim_0001",
    "policyId": "pio-pol-2026-0001",
    "amount": { "amount": 500, "currency": "USD" },
    "mode": "stripe_test_mode",
    "paidAt": "2026-06-17T18:10:04-04:00"
  }'
```

Claim approval and payout completion are separate. Deterministic settlement creates `payout_requested`; Stripe Skills then produce `payout_issued` or `payout_failed`.

## Audit reports

Audit reports are living artifacts until the workflow reaches a terminal state. PIO derives `draft` reports from the current ledger during quote, payment, monitoring, and trigger evaluation. Once the workflow reaches `payout_issued`, `not_triggered`, or `manual_review`, the report is marked `final` with a source event count and terminal settlement facts, then persisted as an immutable `auditSnapshot`. Draft reports remain derived views; only final reports become stored artifacts.
