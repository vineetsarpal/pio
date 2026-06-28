import { NextResponse } from "next/server";
import { buildAgentCard } from "@/lib/agent-card";

/**
 * Serves PIO's A2A-style Agent Card. Reachable at the canonical well-known URL
 * `/.well-known/agent-card.json` via the rewrite in `next.config.ts` (Next does
 * not reliably route dot-prefixed folders, so the card lives here and the
 * well-known path rewrites onto it).
 *
 * The base URL is taken from the configured app URL, falling back to the request
 * origin so the card self-describes correctly on any deployment (matches the
 * pattern in `lib/stripe-checkout.ts`).
 */
export async function GET(request: Request) {
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? new URL(request.url).origin;
  return NextResponse.json(buildAgentCard(baseUrl));
}
