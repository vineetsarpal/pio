import { createHmac, randomUUID } from "crypto";
import type { PricingJob } from "./pricing-job";

type WebhookResult =
  | { attempted: false; reasonCode: "not_configured" }
  | { attempted: true; accepted: true; status: number }
  | { attempted: true; accepted: false; status?: number; reasonCode: "request_failed"; message: string };

const WEBHOOK_TIMEOUT_MS = 4000;

function pricingWebhookConfig() {
  const url = process.env.HERMES_PRICING_WEBHOOK_URL?.trim();
  const secret = process.env.HERMES_PRICING_WEBHOOK_SECRET?.trim();
  if (!url || !secret) return undefined;
  return { url, secret };
}

function signature(body: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export async function triggerHermesPricingWebhook(job: PricingJob): Promise<WebhookResult> {
  const config = pricingWebhookConfig();
  if (!config) return { attempted: false, reasonCode: "not_configured" };

  const body = JSON.stringify({
    event: "pricing.job.created",
    quoteId: job.quoteId,
    status: job.status,
    job
  });

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "pricing.job.created",
        "X-GitHub-Delivery": randomUUID(),
        "X-Hub-Signature-256": signature(body, config.secret)
      },
      body,
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS)
    });

    return response.ok
      ? { attempted: true, accepted: true, status: response.status }
      : { attempted: true, accepted: false, status: response.status, reasonCode: "request_failed", message: `Hermes webhook returned ${response.status}` };
  } catch (error) {
    return {
      attempted: true,
      accepted: false,
      reasonCode: "request_failed",
      message: error instanceof Error ? error.message : "Hermes webhook request failed"
    };
  }
}
