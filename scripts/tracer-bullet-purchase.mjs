#!/usr/bin/env node
// Tracer bullet: the thinnest non-browser proof that an agent can buy coverage
// in Stripe test mode. Drives quote -> off-session PaymentIntent (confirm:true,
// off_session:true against a vaulted test card) -> payment_intent.succeeded
// webhook -> premium_collected -> policy_issued, then reads the policy back.
//
// Prereqs (setup, not design):
//   - The Next dev server running (npm run dev) with these env vars set:
//       STRIPE_SECRET_KEY=sk_test_...
//       STRIPE_WEBHOOK_SECRET=whsec_...                  (for the webhook route)
//       PIO_AGENT_SEED_KEY=...                           (the seeded agent key)
//       PIO_SEED_STRIPE_CUSTOMER=cus_...                 (seeded customer)
//       PIO_SEED_STRIPE_PAYMENT_METHOD=pm_card_visa      (vaulted test card)
//       NEON_POSTGRES_CONNECTION_STRING=...              (durable policy store)
//   - `stripe listen --forward-to localhost:3000/api/stripe/payment-intent`
//     forwarding payment_intent.succeeded to the webhook route.
//
// Usage: node scripts/tracer-bullet-purchase.mjs

const BASE_URL = process.env.PIO_BASE_URL ?? "http://localhost:3000";
const AGENT_KEY = process.env.PIO_AGENT_SEED_KEY;

if (!AGENT_KEY) {
  console.error("PIO_AGENT_SEED_KEY is required to authenticate the headless purchase.");
  process.exit(1);
}

const coverageRequest = {
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

async function main() {
  console.log("1. Quoting + charging off-session…");
  const purchase = await fetch(`${BASE_URL}/api/agent/purchase`, {
    method: "POST",
    headers: { authorization: `Bearer ${AGENT_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ idempotencyKey: `tracer-${Date.now()}`, coverageRequest })
  });
  const purchaseBody = await purchase.json();
  if (!purchase.ok || !purchaseBody.accepted) {
    console.error(`   ✗ Off-session charge failed (${purchase.status}):`, purchaseBody.reasonCode, purchaseBody.message ?? "");
    process.exit(1);
  }
  const policyId = purchaseBody.policy.id;
  console.log(`   ✓ PaymentIntent ${purchaseBody.paymentIntentId} created for policy ${policyId}`);

  console.log("2. Waiting for payment_intent.succeeded webhook → policy_issued…");
  const deadline = Date.now() + 30_000;
  let status = purchaseBody.policy.status;
  while (Date.now() < deadline) {
    const read = await fetch(`${BASE_URL}/api/agent/policy/${encodeURIComponent(policyId)}`, {
      headers: { authorization: `Bearer ${AGENT_KEY}` }
    });
    const body = await read.json();
    if (read.ok && body.accepted) {
      status = body.status;
      if (status === "policy_issued") {
        console.log("   ✓ Policy issued. Ledger payment events:");
        for (const event of body.paymentEvents) {
          console.log(`     - ${event.kind} ${event.reference} ${event.amount.amount} ${event.amount.currency}`);
        }
        console.log("\n✅ Tracer bullet complete: quote → off-session charge → webhook → policy_issued");
        process.exit(0);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  console.error(`   ✗ Timed out waiting for policy_issued (last status: ${status}).`);
  console.error("     Is `stripe listen --forward-to localhost:3000/api/stripe/payment-intent` running?");
  process.exit(1);
}

main().catch((error) => {
  console.error("Tracer bullet failed:", error);
  process.exit(1);
});
