import { describe, expect, it, vi } from "vitest";
import { generateAuditReport } from "@/lib/audit";
import { demoCoverageRequest, demoWeatherEvidence } from "@/lib/demo-fixtures";
import { runGaugeDemoWorkflow } from "@/lib/gauge-tools";
import type { PaymentAdapter } from "@/lib/payment-adapter";
import { SimulatedHermesStripeSkillsAdapter } from "./fakes";
import type { WeatherOracle } from "@/lib/weather-oracle";
import { normalizeOpenMeteoHourlyRain } from "@/lib/weather-oracle";
import {
  activateMonitoring,
  approveClaim,
  evaluateTrigger,
  issuePolicy,
  markPremiumPaid,
  quotePolicy,
  recordTriggerData,
  recordTriggerEvaluation,
  settleClaim
} from "@/lib/workflow";

describe("adapters", () => {
  it("normalizes Open-Meteo hourly rain into PIO weather observations", () => {
    const observations = normalizeOpenMeteoHourlyRain({
      hourly: {
        time: ["2026-06-20T12:00", "2026-06-20T13:00", "2026-06-20T14:00"],
        rain: [1.2, 0, null]
      }
    });

    expect(observations).toEqual([
      { observedAt: "2026-06-20T12:00", rainfallMm: 1.2 },
      { observedAt: "2026-06-20T13:00", rainfallMm: 0 },
      { observedAt: "2026-06-20T14:00", rainfallMm: null }
    ]);
  });

  it("blocks simulated Stripe payout when premium payment is missing", async () => {
    const adapter = new SimulatedHermesStripeSkillsAdapter();
    const policy = quotePolicy(demoCoverageRequest);

    await expect(adapter.initiatePayout(policy)).resolves.toEqual({
      paid: false,
      blockedReason: "Premium payment is not verified."
    });
  });

  it("runs the Gauge demo through payment, oracle, trigger, payout, and audit seams", async () => {
    const run = await runGaugeDemoWorkflow({ payments: new SimulatedHermesStripeSkillsAdapter() });

    expect(run.policy.status).toBe("payout_issued");
    expect(run.decision.approved).toBe(true);
    expect(run.settlement.payoutReference).toBe("po_test_pio_claim_0001");
    expect(run.audit.facts).toContain("Weather oracle: demo_replay");
    expect(run.actions.map((action) => action.action)).toEqual([
      "Coverage request parsed",
      "Quote generated",
      "Premium collected",
      "Policy issued",
      "Demo replay checked",
      "Trigger evaluated",
      "Payout initiated",
      "Audit report drafted"
    ]);
  });

  it("does not initiate a Stripe payout when deterministic trigger evaluation rejects settlement", async () => {
    const payoutSpy = vi.fn();
    const payments: PaymentAdapter = {
      mode: "stripe_test_mode",
      createCustomer: vi.fn(async (name) => ({ id: "cus_test_low_rain", name })),
      createCheckout: vi.fn(async (policy) => ({
        id: "cs_test_low_rain",
        url: "https://checkout.stripe.com/c/pay/cs_test_low_rain",
        premium: policy.premium,
        mode: "stripe_test_mode"
      })),
      verifyPayment: vi.fn(async () => ({
        paid: true,
        paymentReference: "cs_test_low_rain",
        paidAt: "2026-06-17T09:02:15-04:00"
      })),
      initiatePayout: payoutSpy
    };
    const oracle: WeatherOracle = {
      source: "demo_replay",
      getRainfall: vi.fn(async () => ({
        source: "demo_replay",
        metadata: demoWeatherEvidence.metadata,
        observations: [{ observedAt: "2026-06-20T13:00:00-04:00", rainfallMm: 1 }]
      }))
    };

    const run = await runGaugeDemoWorkflow({ payments, oracle });

    expect(run.decision.approved).toBe(false);
    expect(run.policy.status).toBe("not_triggered");
    expect(payoutSpy).not.toHaveBeenCalled();
  });

  it("blocks Gauge policy issuance when payment verification is unpaid", async () => {
    const payments: PaymentAdapter = {
      mode: "stripe_test_mode",
      createCustomer: vi.fn(async (name) => ({ id: "cus_test_unpaid", name })),
      createCheckout: vi.fn(async (policy) => ({
        id: "cs_test_unpaid",
        url: "https://checkout.stripe.com/c/pay/cs_test_unpaid",
        premium: policy.premium,
        mode: "stripe_test_mode"
      })),
      verifyPayment: vi.fn(async () => ({
        paid: false,
        paymentReference: "cs_test_unpaid",
        paidAt: "2026-06-17T09:02:15-04:00"
      })),
      initiatePayout: vi.fn()
    };

    await expect(runGaugeDemoWorkflow({ payments })).rejects.toThrow(
      "premium payment was not verified"
    );
    expect(payments.initiatePayout).not.toHaveBeenCalled();
  });

  it("generates audit facts from policy terms, weather evidence, and payment references", () => {
    const quoted = quotePolicy(demoCoverageRequest);
    const paid = markPremiumPaid(quoted, "cs_test_paid", "2026-06-17T09:02:15-04:00");
    const issued = issuePolicy(paid, "2026-06-17T09:02:18-04:00");
    const triggerData = recordTriggerData(activateMonitoring(issued));
    const decision = evaluateTrigger(triggerData, demoWeatherEvidence);
    const evaluated = recordTriggerEvaluation(triggerData);
    const settlement = settleClaim(
      approveClaim(evaluated),
      decision,
      "po_test_paid",
      "2026-06-17T18:10:04-04:00"
    );
    const audit = generateAuditReport(settlement.policy, demoWeatherEvidence, settlement);

    expect(audit.summary).toContain("trigger 5 mm");
    expect(audit.facts).toContain("Premium payment: cs_test_paid");
    expect(audit.facts).toContain("Payout reference: po_test_paid");
  });
});
