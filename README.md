# PIO

PIO is a parametric insurance platform for automated, evidence-grounded weather coverage. It pairs an agent operator (Gauge) with deterministic underwriting and settlement logic so that money movement and claim approval are always controlled by typed functions rather than free-form model output.

The reference product is rain cover for outdoor markets:

- quote a fixed $25 premium for a $500 payout
- issue a policy only after premium payment is verified
- monitor rainfall observations against the policy trigger
- evaluate the trigger with deterministic code
- initiate a Stripe payout only after deterministic claim approval
- produce a grounded audit report and agent action log for every policy

## Getting started

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Testing

```bash
npm test
```

The test suite covers the workflow state machine, payment events, ledger consistency, operator review, audit generation, and the agent coverage adapters.

## Architecture

PIO separates deterministic insurance logic from the agent orchestration and external service adapters. Core seams:

- `lib/workflow.ts` — deterministic quote, issue, trigger, and settlement logic
- `lib/state-machine.ts` — policy transition map that constrains agent tool execution
- `lib/policy-store.ts` — source-of-truth policy ledger interface and in-memory event-store implementation
- `lib/weather-oracle.ts` — seeded replay and Open-Meteo weather oracle adapters
- `lib/payment-adapter.ts` — Stripe Skills-shaped payment adapter boundary
- `lib/payment-events.ts` — immutable premium and payout event handlers
- `lib/gauge-tools.ts` — Gauge orchestration surface for the coverage workflow
- `lib/agent-coverage.ts` — customer-owned agent coverage request and purchase logic
- `lib/audit.ts` — grounded audit reports derived from policy, weather, and payment facts
- `lib/ledger-consistency.ts` — projection checks proving current policy rows match status-changing events
- `lib/operator-review.ts` — ledger-derived queue for manual weather reviews and payout failures
- `lib/types.ts` — machine-readable policy, trigger, weather, settlement, and action records
- `lib/demo-data.ts`, `lib/demo-fixtures.ts` — seeded policy, weather observations, and action log
- `app/page.tsx` — operator surface for policy, monitoring, settlement, and audit views
- `app/api/*` — HTTP endpoints for the workflow, quotes, agent coverage, Stripe events, and operator review

External integrations — Hermes, Stripe Skills, Open-Meteo, and model providers — sit behind adapter boundaries so they can be swapped without changing the orchestration code. Money movement and trigger approval stay inside typed deterministic functions.

### Persistence

The persistence boundary is an in-memory policy ledger with `policies`, `workflowEvents`, `paymentEvents`, and terminal `auditSnapshots`. It is shaped so SQLite with Prisma or Drizzle can replace the implementation without changing the orchestration code. Policy rows are kept for fast UI/API reads, while workflow events remain the audit spine. `ledgerConsistency` projects the latest status-changing workflow event and verifies that each current row matches it.

### Workflow state machine

Gauge is modeled as a policy-state-machine operator, not a free-form workflow runner. The happy path is:

```text
policy_quoted -> premium_paid -> policy_issued -> monitoring_active
-> trigger_data_received -> trigger_evaluated -> claim_approved
-> payout_issued
```

Non-triggered claims move from `trigger_evaluated` to `not_triggered`. The payout adapter is only called after deterministic claim approval.

### Evidence policy

Weather evidence is snapshot-based. Replayed observations are treated as settlement-grade; live Open-Meteo evidence is treated as advisory until it has an immutable source URL, request params, capture timestamp, normalization version, and missing-data policy. Missing or advisory evidence fails closed into `manual_review` — never an automatic payout.

## API

Run the complete workflow:

```bash
curl http://localhost:3000/api/demo-run
```

Request a quote (for a human UI or a customer-owned agent):

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

Customer-owned agent coverage request:

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

If the premium cap is too low, the response is rejected with `reasonCode: "premium_cap_exceeded"` and includes both the quoted premium and maximum premium. The endpoint only quotes or directs checkout creation; policy issuance still requires payment verification and state-machine transitions.

Customer-owned agent purchase confirmation:

```bash
curl -X POST http://localhost:3000/api/agent/confirm-purchase \
  -H "Content-Type: application/json" \
  -d '{
    "agentId": "ops-agent-north-pier",
    "quoteId": "pio-pol-2026-0001",
    "idempotencyKey": "idem-agent-buy-0001",
    "authorization": "confirm_purchase",
    "maximumPremium": { "amount": 75, "currency": "USD" },
    "coverageRequest": {
      "customerName": "North Pier Pop-up Market",
      "eventName": "Saturday Harbor Market",
      "locationName": "Toronto Waterfront",
      "latitude": 43.6405,
      "longitude": -79.3764,
      "eventStart": "2026-06-20T12:00:00-04:00",
      "eventEnd": "2026-06-20T18:00:00-04:00",
      "desiredPayout": { "amount": 500, "currency": "USD" }
    }
  }'
```

The confirmation endpoint re-quotes deterministically, re-checks the premium cap, verifies the quote id, and uses the idempotency key to replay identical confirmations or reject conflicting retries. It creates checkout only; issuing the policy still requires verified payment.

Stripe premium-collected event:

```bash
curl -X POST http://localhost:3000/api/stripe/premium-collected \
  -H "Content-Type: application/json" \
  -d '{
    "providerEventId": "evt_test_pio_premium_collected_0001",
    "checkoutId": "cs_test_pio_premium_0001",
    "policyId": "pio-pol-2026-0001",
    "amount": { "amount": 25, "currency": "USD" },
    "mode": "stripe_test_mode",
    "paidAt": "2026-06-17T09:02:15-04:00"
  }'
```

Premium completion is modeled as an immutable payment event. The operator may ask Stripe Skills for status, but policy activation depends on the accepted `premium_collected` event tied to the checkout id.

Stripe payout-completed event:

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

Payout failure:

```bash
curl -X POST http://localhost:3000/api/stripe/payout-failed \
  -H "Content-Type: application/json" \
  -d '{
    "providerEventId": "evt_test_pio_payout_failed_0001",
    "requestId": "payout-request-pio-pol-2026-0001",
    "policyId": "pio-pol-2026-0001",
    "amount": { "amount": 500, "currency": "USD" },
    "mode": "stripe_test_mode",
    "failedAt": "2026-06-17T18:10:04-04:00",
    "failureReason": "simulated_stripe_failure"
  }'
```

Claim approval and payout completion are separate. Deterministic settlement creates `payout_requested`; Stripe Skills then produce `payout_issued` or `payout_failed`.

Operator review queue:

```bash
curl http://localhost:3000/api/operator/review-queue
```

Operator review is derived from the ledger. Policies in `manual_review` and payment events with `payout_failed` become open queue items; clean automatic claims do not create review records.

## Audit reports

Audit reports are living artifacts until the workflow reaches a terminal state. PIO derives `draft` reports from the current ledger during quote, payment, monitoring, and trigger evaluation. Once the workflow reaches `payout_issued`, `not_triggered`, or `manual_review`, the report is marked `final` with a source event count and terminal settlement facts, then persisted as an immutable `auditSnapshot`. Draft reports remain derived views; only final reports become stored artifacts.
