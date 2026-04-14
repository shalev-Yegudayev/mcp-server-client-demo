import { GoogleGenerativeAI, type FunctionDeclaration } from '@google/generative-ai';
import type { McpClient } from './mcpClient.js';

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// 8 KB ≈ 2k tokens at ~4 bytes/token; keeps Gemini context manageable per tool call.
const MAX_TOOL_RESULT_BYTES = 8192;

const MAX_ITERATIONS = 10;

function buildFunctionDeclarations(tools: Tool[]): FunctionDeclaration[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parameters: tool.inputSchema as any,
  }));
}

function truncateIfNeeded(toolName: string, result: unknown): unknown {
  const json = JSON.stringify(result);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes <= MAX_TOOL_RESULT_BYTES) return result;

  console.warn(`Tool ${toolName} returned ${bytes} bytes (max ${MAX_TOOL_RESULT_BYTES}). Truncating.`);

  if (Array.isArray(result)) {
    return {
      truncated: true,
      totalItems: result.length,
      message: `Result contained ${result.length} items. Showing first 5. Use pagination to refine your query.`,
      items: result.slice(0, 5),
    };
  }

  return {
    truncated: true,
    message: `Result was too large (${Math.round(bytes / 1024)}KB). Please use more specific filters or pagination.`,
  };
}

export async function ask(question: string, mcpClient: McpClient): Promise<string> {
  const tools = await mcpClient.listTools();

  const model = gemini.getGenerativeModel({
    model: 'gemini-1.5-flash',
    tools: [{ functionDeclarations: buildFunctionDeclarations(tools) }],
  });

  const chat = model.startChat({ history: [] });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let response: any = await chat.sendMessage(question);

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const functionCalls = response.functionCalls();
    if (!functionCalls || functionCalls.length === 0) break;

    const toolResults = await Promise.all(
      functionCalls.map(async (call: { name: string; args: Record<string, unknown> }) => {
        try {
          const result = await mcpClient.callTool(call.name, call.args);
          return { name: call.name, response: truncateIfNeeded(call.name, result) };
        } catch (error) {
          return { name: call.name, response: { error: String(error) } };
        }
      }),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    response = await chat.sendMessage(
      toolResults.map((tr) => ({ functionResponse: { name: tr.name, response: tr.response } }) as any),
    );
  }

  const text = response.text();
  const hitLimit = response.functionCalls()?.length > 0;
  return hitLimit ? text + '\n\n[Note: Query required too many steps. Some analysis may be incomplete.]' : text;
}
