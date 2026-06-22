import { NextResponse } from "next/server";
import { getPolicyStore } from "@/lib/policy-store-factory";
import { operatorOk, unauthorized } from "../route";

export async function GET(request: Request) {
  if (!operatorOk(request)) return unauthorized();
  const since = new URL(request.url).searchParams.get("since") ?? undefined;
  const store = getPolicyStore();
  // Read env inside handler so tests can set these before each call
  const holdMs = Number(process.env.PIO_PRICING_QUEUE_HOLD_MS ?? 25_000);
  const pollMs = Number(process.env.PIO_PRICING_QUEUE_POLL_MS ?? 1_000);
  const deadline = Date.now() + holdMs;
  for (;;) {
    const jobs = await store.listPendingPricingJobs(since);
    if (jobs.length > 0 || Date.now() >= deadline) {
      return NextResponse.json({ accepted: true, jobs });
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
