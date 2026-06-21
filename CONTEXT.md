# PIO — Parametric Coverage Context

PIO issues parametric weather/flight coverage: a customer (or an agent) buys a
Policy whose payout is decided deterministically from an external data feed, not
by adjuster judgement. This file fixes the language so code, docs, and reviews
use the same words.

## Language

### Coverage lifecycle

**Policy**:
A bound coverage contract for one event, carrying its terms, premium, payout,
trigger, and lifecycle status.
_Avoid_: contract, plan, product (a "product" is the template a Policy is quoted from)

**Quote**:
A priced, not-yet-bound offer produced by the canonical quote engine
(`quoteCoverageProduct`). Has an `expiresAt`.
_Avoid_: estimate, proposal

**Premium**:
The amount the customer pays to bind a Policy.

**Payout**:
The fixed amount PIO pays the insured when the Trigger is met, net of any
deductible.
_Avoid_: claim payment, reimbursement

**Claim**:
The lifecycle that runs after a Trigger is detected on an active Policy,
ending in settlement or denial.

**Settlement**:
The terminal resolution of a Claim — paid, denied, or no-trigger.

**Trigger**:
The deterministic condition (e.g. rainfall > threshold over the window) that,
when met, entitles the Policy to its Payout.

**Weather Oracle**:
The external data feed (live or demo) that supplies the observations a Trigger
is evaluated against.
_Avoid_: weather API, data source

### The ledger and its events

**Ledger**:
The durable, append-only record of Policies plus their workflow, payment, and
audit events. Reached only through the `PolicyStore` interface; money mutations
go through `withTransaction`.
_Avoid_: database, store (when you mean the durable record itself)

**Money Event**:
A domain event recording movement of money against a Policy in the Ledger —
premium collected, payout requested, payout completed, payout failed. Applying
one is always idempotent and transactional.
_Avoid_: payment event (the persisted row), transaction

**Inbound Money Event**:
A Money Event that originates as a verified Stripe webhook (premium collected,
payout completed, payout failed). Carries an **Event Identity** and flows
through verify → normalize → apply.
_Avoid_: webhook event

**Outbound action**:
A money step PIO initiates by calling Stripe (payout requested). Not a webhook;
does not carry an inbound Event Identity.

**Event Identity**:
The Stripe event id (`evt_…`) that uniquely names an Inbound Money Event. It is
the idempotency key for applying that event to the Ledger — "have I already
applied `evt_…`?".
_Avoid_: dedup key, reference (the business reference — `checkoutId`,
`payoutReference` — is a separate, queryable field, not the identity)
