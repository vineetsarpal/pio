# PIO

PIO is a scaffold for a hackathon demo of a Hermes-powered parametric insurance operator.

The first product is simulated rain cover for outdoor markets:

- quote a fixed $25 premium for a $500 payout
- issue a demo policy only after premium payment is verified
- replay seeded rainfall observations
- evaluate the rain trigger with deterministic code
- initiate a Stripe test-mode payout only after deterministic approval
- show Gauge's agent action log and audit explanation

## Run locally

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Test

```bash
npm test
```

## Architecture seams

- `lib/workflow.ts`: deterministic quote, issue, trigger, and settlement logic
- `lib/weather-oracle.ts`: seeded replay and Open-Meteo weather oracle adapters
- `lib/payment-adapter.ts`: Stripe Skills-shaped payment adapter boundary
- `lib/gauge-tools.ts`: Gauge/Hermes orchestration surface for the demo workflow
- `lib/audit.ts`: grounded audit report generation from policy, weather, and payment facts
- `lib/ledger-consistency.ts`: projection checks proving current policy rows match status-changing ledger events
- `lib/operator-review.ts`: ledger-derived queue for manual weather reviews and payout failures
- `lib/state-machine.ts`: deterministic policy transition map used to constrain Gauge tool execution
- `lib/policy-store.ts`: source-of-truth policy ledger interface and in-memory event-store implementation
- `lib/demo-data.ts`: seeded demo policy, weather observations, and Gauge action log
- `app/api/demo-run/route.ts`: JSON endpoint for the complete demo workflow
- `app/api/quote/route.ts`: quote endpoint for a human UI or future customer-owned agent
- `app/api/operator/review-queue/route.ts`: operator exception queue derived from the policy ledger
- `lib/types.ts`: machine-readable policy, trigger, weather, settlement, and action records
- `app/page.tsx`: SaaS demo surface for policy, monitoring, settlement, and audit views

Hermes, Stripe Skills, Open-Meteo, and NVIDIA/Nemotron integrations are intentionally adapter-shaped next steps. The first scaffold keeps money movement and trigger approval controlled by typed deterministic functions.

The current persistence boundary is an in-memory policy ledger with `policies`, `workflowEvents`, `paymentEvents`, and terminal `auditSnapshots`. It is deliberately shaped so SQLite with Prisma or Drizzle can replace the implementation without changing the Gauge orchestration code. Policy rows are kept for fast UI/API reads, while workflow events remain the audit spine. `ledgerConsistency` projects the latest status-changing workflow event and verifies each current row matches it.

Gauge is modeled as a policy-state-machine operator, not a free-form workflow runner. The current happy path is:

```text
policy_quoted -> premium_paid -> policy_issued -> monitoring_active
-> trigger_data_received -> trigger_evaluated -> claim_approved
-> payout_issued
```

Non-triggered claims move from `trigger_evaluated` to `not_triggered`. The payout adapter is only called after deterministic claim approval.

Weather evidence is snapshot-based. Demo replay is marked settlement-grade; live Open-Meteo evidence is marked advisory until it has an immutable source URL, request params, capture timestamp, normalization version, and missing-data policy. Missing or advisory evidence fails closed into `manual_review`, never an automatic payout.

## API sketch

```bash
curl http://localhost:3000/api/demo-run
```

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

Customer-owned agent request:

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

Simulated Stripe premium-collected event:

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

Premium completion is modeled as an immutable payment event. Gauge may ask Stripe Skills for status, but policy activation depends on the accepted `premium_collected` event tied to the checkout id.

Simulated Stripe payout-completed event:

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

Simulated payout failure:

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

Audit reports are living artifacts until the workflow reaches a terminal state. PIO can derive `draft` reports from the current ledger during quote, payment, monitoring, and trigger evaluation. Once the workflow reaches `payout_issued`, `not_triggered`, or `manual_review`, the report is marked `final` with a source event count and terminal settlement facts, then persisted as an immutable `auditSnapshot`. Draft reports remain derived views; only final reports become stored artifacts.

Operator review is also derived from the ledger. Policies in `manual_review` and payment events with `payout_failed` become open queue items; clean automatic claims do not create review records. The current demo endpoint is:

```bash
curl http://localhost:3000/api/operator/review-queue
```
