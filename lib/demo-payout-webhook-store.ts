import { demoCoverageRequest, demoWeatherEvidence } from "./demo-fixtures";
import { handlePayoutRequestedEvent, handlePremiumCollectedEvent } from "./payment-events";
import { InMemoryPolicyStore } from "./policy-store";
import type { TriggerDecision } from "./types";
import {
  activateMonitoring,
  approveClaim,
  evaluateTrigger,
  issuePolicy,
  quotePolicy,
  recordTriggerData,
  recordTriggerEvaluation
} from "./workflow";

type DemoPayoutWebhookState = {
  store: InMemoryPolicyStore;
  decision?: TriggerDecision;
  seed?: Promise<void>;
};

const globalDemoPayoutState = globalThis as typeof globalThis & {
  pioDemoPayoutWebhookState?: DemoPayoutWebhookState;
};

const state =
  globalDemoPayoutState.pioDemoPayoutWebhookState ??=
  {
    store: new InMemoryPolicyStore()
  };

state.seed ??= (async () => {
  const quoted = quotePolicy(demoCoverageRequest);
  await state.store.savePolicy(quoted);
  const premium = await handlePremiumCollectedEvent(
    {
      providerEventId: "evt_test_pio_premium_for_payout_webhook",
      checkoutId: "cs_test_pio_premium_for_payout_webhook",
      policyId: quoted.id,
      amount: quoted.premium,
      mode: "stripe_test_mode",
      paidAt: "2026-06-17T09:02:15-04:00"
    },
    state.store
  );
  if (!premium.accepted) throw new Error(premium.message);

  const issued = issuePolicy(premium.policy, "2026-06-17T09:02:18-04:00");
  const triggerData = recordTriggerData(activateMonitoring(issued));
  const decision = evaluateTrigger(triggerData, demoWeatherEvidence);
  const approved = approveClaim(recordTriggerEvaluation(triggerData));
  await state.store.savePolicy(approved);
  const requested = await handlePayoutRequestedEvent(
    {
      requestId: `payout-request-${approved.id}`,
      policyId: approved.id,
      amount: approved.payout,
      mode: "stripe_test_mode",
      requestedAt: "2026-06-17T18:10:03-04:00"
    },
    state.store
  );
  if (!requested.accepted) throw new Error(requested.message);

  state.decision = decision;
})();

export async function getDemoPayoutWebhookState() {
  await state.seed;
  if (!state.decision) throw new Error("Demo payout webhook decision was not seeded.");
  return {
    store: state.store,
    decision: state.decision
  };
}
