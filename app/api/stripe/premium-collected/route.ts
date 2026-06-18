import { NextResponse } from "next/server";
import type { PremiumCollectedEvent } from "@/lib/types";
import { demoCoverageRequest } from "@/lib/demo-fixtures";
import { handlePremiumCollectedEvent } from "@/lib/payment-events";
import { InMemoryPolicyStore, workflowEvent } from "@/lib/policy-store";
import { quotePolicy } from "@/lib/workflow";

const globalStripeWebhookState = globalThis as typeof globalThis & {
  pioPremiumCollectedStore?: InMemoryPolicyStore;
  pioPremiumCollectedSeed?: Promise<void>;
};

const store = (globalStripeWebhookState.pioPremiumCollectedStore ??= new InMemoryPolicyStore());
const seedStore =
  globalStripeWebhookState.pioPremiumCollectedSeed ??=
  (async () => {
    const demoPolicy = quotePolicy(demoCoverageRequest);
    await store.savePolicy(demoPolicy);
    await store.appendWorkflowEvent(
      workflowEvent({
        policyId: demoPolicy.id,
        at: "2026-06-17T09:01:03-04:00",
        kind: "policy_quoted",
        actor: "PIO deterministic engine",
        summary: "Demo quote seeded for simulated Stripe premium-collected webhook.",
        data: { premium: demoPolicy.premium, payout: demoPolicy.payout, trigger: demoPolicy.trigger }
      })
    );
  })();

export async function POST(request: Request) {
  await seedStore;
  const event = (await request.json()) as PremiumCollectedEvent;
  const result = await handlePremiumCollectedEvent(event, store);
  return NextResponse.json(result, { status: result.accepted ? 200 : 422 });
}
