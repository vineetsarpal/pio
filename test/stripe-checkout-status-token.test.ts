import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveStripeCheckoutAdapter } from "@/lib/stripe-checkout";
import { demoCoverageRequest } from "@/lib/demo-fixtures";
import { quotePolicy } from "@/lib/workflow";

const realFetch = global.fetch;

function captureFetch() {
  const calls: Array<{ url: string; body: string }> = [];
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    return new Response(JSON.stringify({ id: "cs_test_x", url: "https://stripe.test/pay" }), { status: 200 });
  }) as unknown as typeof fetch;
  return calls;
}

beforeEach(() => {
  process.env.PIO_POLICY_STATUS_TOKEN_SECRET = "test-status-secret";
});
afterEach(() => {
  global.fetch = realFetch;
});

describe("LiveStripeCheckoutAdapter success_url status token", () => {
  it("appends the status token to success_url when provided", async () => {
    const calls = captureFetch();
    const adapter = new LiveStripeCheckoutAdapter({ secretKey: "sk_test_x", appUrl: "https://pio.test" });
    const policy = quotePolicy(demoCoverageRequest);
    await adapter.createCheckout(policy, { id: "c1", name: "Buyer" }, { statusToken: "999.abcd" });

    const body = decodeURIComponent(calls[0].body);
    expect(body).toContain("success_url=https://pio.test/buy/success");
    expect(body).toContain("&t=999.abcd");
  });

  it("omits the token when not provided", async () => {
    const calls = captureFetch();
    const adapter = new LiveStripeCheckoutAdapter({ secretKey: "sk_test_x", appUrl: "https://pio.test" });
    const policy = quotePolicy(demoCoverageRequest);
    await adapter.createCheckout(policy, { id: "c1", name: "Buyer" });

    const body = decodeURIComponent(calls[0].body);
    expect(body).not.toContain("&t=");
  });
});
