/**
 * PIO MCP server — a stdio Model Context Protocol server the Hermes agent
 * spawns on the VPS at startup. It exposes the six real PIO operations as
 * callable tools and forwards each call to the PIO deployment over HTTPS.
 *
 * It is NOT a network service: Hermes launches it as a child process and talks
 * to it over stdin/stdout. The only network hop is outbound to PIO.
 *
 * Run it (after `npm install && npm run build` in this directory):
 *
 *   PIO_BASE_URL=https://pio-platform.vercel.app \
 *   PIO_AGENT_SEED_KEY=... PIO_OPERATOR_KEY=... \
 *   node dist/mcp-server.js
 *
 * Hermes config (mcp_servers.pio):
 *   command: "node"
 *   args: ["/home/vineet/pio/hermes/dist/mcp-server.js"]
 *   env: { PIO_BASE_URL, PIO_AGENT_SEED_KEY, PIO_OPERATOR_KEY }
 *
 * Deterministic invariant: `settle_policy` triggers PIO's settlement, which
 * evaluates the trigger and decides the payout in typed server-side code. This
 * server never approves claims or moves money — it only relays calls.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { PioClient } from "./pio-client.js";
import { activeScopesFromEnv, handlePioToolCall, pioMcpToolList } from "./mcp-tools.js";

const baseUrl = process.env.PIO_BASE_URL;
if (!baseUrl) {
  // stderr only — stdout is the MCP JSON-RPC channel and must stay clean.
  console.error("PIO_BASE_URL is required (e.g. https://pio-platform.vercel.app).");
  process.exit(1);
}

const client = new PioClient({
  baseUrl,
  agentKey: process.env.PIO_AGENT_SEED_KEY,
  operatorKey: process.env.PIO_OPERATOR_KEY
});

const server = new Server({ name: "pio", version: "0.1.0" }, { capabilities: { tools: {} } });

const scopes = activeScopesFromEnv(process.env);
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: pioMcpToolList(scopes) }));

server.setRequestHandler(CallToolRequestSchema, async (request) =>
  handlePioToolCall(client, request.params.name, (request.params.arguments ?? {}) as Record<string, unknown>)
);

await server.connect(new StdioServerTransport());
console.error("PIO MCP server connected over stdio.");
