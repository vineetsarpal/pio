# PIO Hermes tools

Stdio MCP server exposing PIO buyer + operator tools to the Hermes (Gauge) runtime, plus the system prompts that direct them.

## Two roles from one binary

The tool list is scoped by which key is set in the MCP server's env:

| Instance | Env keys | Tools exposed | Prompt |
|----------|----------|---------------|--------|
| Operator (Gauge) | `PIO_BASE_URL`, `PIO_OPERATOR_KEY` | settle_policy, get_review_queue, wait_for_pricing_job, submit_research_quote | `prompts/gauge-operator.md` |
| Buyer | `PIO_BASE_URL`, `PIO_AGENT_SEED_KEY` | request_coverage, request_dynamic_coverage, confirm_purchase, confirm_dynamic_purchase, purchase_off_session, get_policy | `prompts/buyer-agent.md` |

Set only the key for the role you want; with both set, all tools are exposed (single-host dev).

## Run

```bash
npm install && npm run build
PIO_BASE_URL=https://pio-platform.vercel.app PIO_OPERATOR_KEY=… node dist/mcp-server.js   # operator
PIO_BASE_URL=https://pio-platform.vercel.app PIO_AGENT_SEED_KEY=… node dist/mcp-server.js  # buyer
```

Load the matching prompt file as the agent's system prompt. The operator needs a web-search (Firecrawl) tool from its runtime; this server does not provide one.

## Demo order

buyer `request_dynamic_coverage` → operator `wait_for_pricing_job` → researches → `submit_research_quote` → buyer polls `get_policy` until `policy_quoted` → `confirm_dynamic_purchase`.
