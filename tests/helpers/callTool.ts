import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface ToolCallResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

/**
 * Invokes a registered tool handler by name.
 * Wraps access to the SDK's internal `_registeredTools` map in one place so
 * individual tests are decoupled from SDK internals.
 */
export async function callTool(
  server: McpServer,
  name: string,
  args: unknown,
): Promise<ToolCallResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools = (server as any)._registeredTools as Record<
    string,
    { handler: (a: unknown) => Promise<ToolCallResult> }
  >;
  const tool = tools[name];
  if (!tool) throw new Error(`tool "${name}" not registered`);
  return tool.handler(args);
}

export function parseResult(result: ToolCallResult): unknown {
  return JSON.parse(result.content[0].text);
}
