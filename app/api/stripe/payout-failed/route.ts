import { NextResponse } from "next/server";
import type { PayoutFailedEvent } from "@/lib/types";
import { getDemoPayoutWebhookState } from "@/lib/demo-payout-webhook-store";
import { handlePayoutFailedEvent } from "@/lib/payment-events";

export async function POST(request: Request) {
  const { store } = await getDemoPayoutWebhookState();
  const event = (await request.json()) as PayoutFailedEvent;
  const result = await handlePayoutFailedEvent(event, store);
  return NextResponse.json(result, { status: result.accepted ? 200 : 422 });
}
