# PIO Hermes tools

Stdio MCP server exposing PIO buyer + operator tools to the Hermes (Gauge) runtime, plus the system prompts that direct them.

## Two roles from one binary

The tool list is scoped by which key is set in the MCP server's env:

| Instance | Env keys | Tools exposed | Prompt |
|----------|----------|---------------|--------|
| Operator (Gauge) | `PIO_BASE_URL`, `PIO_OPERATOR_KEY` | settle_policy, get_review_queue, wait_for_pricing_job, submit_research_quote, report_progress | `prompts/gauge-operator.md` |
| Buyer | `PIO_BASE_URL`, `PIO_AGENT_SEED_KEY` | request_coverage, request_dynamic_coverage, confirm_purchase, confirm_dynamic_purchase, purchase_off_session, get_policy | `prompts/buyer-agent.md` |

Set only the key for the role you want; with both set, all tools are exposed (single-host dev).

## Run

```bash
npm install && npm run build
PIO_BASE_URL=https://pio-platform.vercel.app PIO_OPERATOR_KEY=… node dist/mcp-server.js   # operator
PIO_BASE_URL=https://pio-platform.vercel.app PIO_AGENT_SEED_KEY=… node dist/mcp-server.js  # buyer
```

Load the matching prompt file as the agent's system prompt. The operator needs a web-search (Firecrawl) tool from its runtime; this server does not provide one.

`PIO_OPERATOR_KEY` on the VPS **must equal** the `PIO_OPERATOR_KEY` set in the PIO deployment (Vercel) — a mismatch makes every operator call (`wait_for_pricing_job`, `submit_research_quote`, `report_progress`) return 401 and the handshake silently stalls.

## report_progress (live agent-intake feed)

Best-effort milestone reporting so the buyer sees what the operator is doing in real time. The operator should call `report_progress(quoteId, step, detail?)` at each milestone — before searching (`"researching", "<topic>"`), after finding sources (`"found_sources", "N sources"`), and before submitting (`"scoring", "0.62"`). It is best-effort and must never delay `submit_research_quote`: PIO emits its own `pio`-sourced stage events (`weather_api_called`, `baseline_computed`, `priced`) so the feed renders even if the operator skips reporting.

## Demo order

### Agent-to-agent (both Hermes instances)

buyer `request_dynamic_coverage` → operator `wait_for_pricing_job` → researches (`report_progress` along the way) → `submit_research_quote` → buyer polls `get_policy` until `policy_quoted` → `confirm_dynamic_purchase`.

### Clickable prod-UI demo (buyer = the `/buy` page)

Only the operator (Gauge) runs as a Hermes instance; the buyer is the prod UI and the Buy click uses the seeded agent key server-side.

1. Run the operator instance on the VPS (above) — it sits in `wait_for_pricing_job`.
2. Open `<PIO_BASE_URL>/buy`, fill the form, click **Get Dynamic Quote**. The intake panel shows PIO's `weather_api_called` → `baseline_computed` immediately, then polls every ~2s.
3. Gauge picks up the job, researches, calls `report_progress` at milestones, then `submit_research_quote`. PIO clamps the score into the product band and prices the policy.
4. The panel flips to the priced quote with cited evidence + a **Buy** button → Stripe test checkout.
5. `<PIO_BASE_URL>/ops` shows the live **Pricing queue** (pending → priced with citation count).

If the intake panel shows only the two `pio` lines and never advances, the operator isn't picking up the job — check `PIO_OPERATOR_KEY` matches Vercel, `PIO_BASE_URL` points at prod, the VPS is running the rebuilt `dist/` (with `report_progress`), and Gauge is actually in the wait loop.
