import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as payoutCompleted } from "../app/api/stripe/payout-completed/route";
import { POST as payoutFailed } from "../app/api/stripe/payout-failed/route";

const SECRET = "whsec_test_payout";
const originalWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

beforeAll(() => {
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
});

afterAll(() => {
  if (originalWebhookSecret === undefined) {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  } else {
    process.env.STRIPE_WEBHOOK_SECRET = originalWebhookSecret;
  }
});

function signedPayoutRequest(url: string, body: Record<string, unknown>, secret = SECRET) {
  const payload = JSON.stringify(body);
  const timestamp = 1781800000;
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return new Request(url, {
    method: "POST",
    headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
    body: payload
  });
}

// The demo payout state seeds policy pio-pol-2026-0001 at claim_approved with a
// payout_requested of 500 USD under request id payout-request-pio-pol-2026-0001.
function payoutEvent(type: "payout.paid" | "payout.failed", overrides: Record<string, unknown> = {}) {
  return {
    id: `evt_${type.replace(".", "_")}_route`,
    type,
    created: 1781800123,
    data: {
      object: {
        id: "po_route_001",
        object: "payout",
        amount: 50000,
        currency: "usd",
        status: type === "payout.paid" ? "paid" : "failed",
        metadata: { policy_id: "pio-pol-2026-0001", request_id: "payout-request-pio-pol-2026-0001" },
        ...overrides
      }
    }
  };
}

describe("POST /api/stripe/payout-completed", () => {
  it("rejects a request with an invalid signature", async () => {
    const response = await payoutCompleted(
      signedPayoutRequest("https://pio.test/api/stripe/payout-completed", payoutEvent("payout.paid"), "wrong_secret")
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ reasonCode: "invalid_stripe_signature" });
  });

  it("rejects a wrong-type event", async () => {
    const response = await payoutCompleted(
      signedPayoutRequest("https://pio.test/api/stripe/payout-completed", payoutEvent("payout.failed"))
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ reasonCode: "unsupported_event_type" });
  });

  it("completes a payout from a signed payout.paid event", async () => {
    const response = await payoutCompleted(
      signedPayoutRequest("https://pio.test/api/stripe/payout-completed", payoutEvent("payout.paid"))
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      accepted: true,
      policy: { status: "payout_issued" },
      paymentEvent: { kind: "payout_issued" }
    });
  });
});

describe("POST /api/stripe/payout-failed", () => {
  it("rejects a wrong-type event", async () => {
    const response = await payoutFailed(
      signedPayoutRequest("https://pio.test/api/stripe/payout-failed", payoutEvent("payout.paid"))
    );
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ reasonCode: "unsupported_event_type" });
  });
});
