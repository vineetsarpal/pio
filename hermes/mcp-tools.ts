/**
 * SDK-free bridge between PIO's tool definitions and the MCP wire format.
 *
 * Kept separate from `mcp-server.ts` so the routing logic can be unit-tested
 * without importing `@modelcontextprotocol/sdk` (which only the stdio shim
 * needs). The server file is a thin transport wrapper around these two
 * functions.
 */

import type { PioClient } from "./pio-client.js";
import { dispatchPioToolCall, pioTools, type ToolScope } from "./tools.js";

export type McpToolDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

/** The PIO tools, shaped as MCP tool descriptors. When scopes are given, only tools whose scope is included are returned. */
export function pioMcpToolList(scopes?: ToolScope[]): McpToolDescriptor[] {
  const tools = scopes ? pioTools.filter((tool) => scopes.includes(tool.scope)) : pioTools;
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    inputSchema: tool.function.parameters as unknown as Record<string, unknown>
  }));
}

export function activeScopesFromEnv(env: { PIO_OPERATOR_KEY?: string; PIO_AGENT_SEED_KEY?: string }): ToolScope[] {
  const scopes: ToolScope[] = [];
  if (env.PIO_OPERATOR_KEY) scopes.push("operator");
  if (env.PIO_AGENT_SEED_KEY) scopes.push("buyer");
  return scopes.length > 0 ? scopes : ["buyer", "operator"];
}

/**
 * Execute one MCP tool call against PIO. Dispatch failures (unknown tool,
 * missing scope key) are returned as MCP error results rather than thrown, so a
 * bad call surfaces to the model as tool output instead of crashing the server.
 */
export async function handlePioToolCall(
  client: PioClient,
  name: string,
  args: Record<string, unknown>
): Promise<McpToolResult> {
  try {
    const result = await dispatchPioToolCall(client, name, args ?? {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true
    };
  }
}
