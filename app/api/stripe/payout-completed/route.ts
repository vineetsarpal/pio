import { NextResponse } from "next/server";
import type { PayoutCompletedEvent } from "@/lib/types";
import { getDemoPayoutWebhookState } from "@/lib/demo-payout-webhook-store";
import { handlePayoutCompletedEvent } from "@/lib/payment-events";

export async function POST(request: Request) {
  const { store, decision } = await getDemoPayoutWebhookState();
  const event = (await request.json()) as PayoutCompletedEvent;
  const result = await handlePayoutCompletedEvent(event, store, decision);
  return NextResponse.json(result, { status: result.accepted ? 200 : 422 });
}
