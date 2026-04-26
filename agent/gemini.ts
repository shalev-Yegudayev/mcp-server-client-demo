import { GoogleGenAI, type FunctionDeclaration } from '@google/genai';
import type { McpClient } from './mcpClient.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

// 8 KB ≈ 2k tokens at ~4 bytes/token; keeps Gemini context manageable per tool call.
const MAX_TOOL_RESULT_BYTES = 8192;

const MAX_ITERATIONS = parseInt(process.env.GEMINI_MAX_ITERATIONS ?? '10', 10);

function buildFunctionDeclarations(tools: Tool[]): FunctionDeclaration[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parametersJsonSchema: tool.inputSchema,
  }));
}

export function truncateIfNeeded(toolName: string, result: unknown): unknown {
  const json = JSON.stringify(result);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes <= MAX_TOOL_RESULT_BYTES) return result;

  console.warn(
    `Tool ${toolName} returned ${bytes} bytes (max ${MAX_TOOL_RESULT_BYTES}). Truncating.`,
  );

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

export async function ask(
  question: string,
  mcpClient: McpClient,
  signal?: AbortSignal,
): Promise<string> {
  // Fetch available MCP tools and register them with the model so Gemini knows what it can call.
  const tools = await mcpClient.listTools();

  const requestConfig = {
    tools: [{ functionDeclarations: buildFunctionDeclarations(tools) }],
    systemInstruction: SYSTEM_PROMPT,
    abortSignal: signal,
  };

  const chat = ai.chats.create({
    model: GEMINI_MODEL,
    config: requestConfig,
  });

  // Send the user's question. The SDK appends to history automatically.
  let response = await chat.sendMessage({ message: question, config: requestConfig });

  // Agentic loop: keep executing tool calls until the model stops requesting them or we hit the limit.
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const functionCalls = response.functionCalls;
    if (!functionCalls || functionCalls.length === 0) break;

    // Execute all requested tool calls in parallel, capping each result to MAX_TOOL_RESULT_BYTES.
    const toolResults = await Promise.all(
      functionCalls.map(async (call) => {
        try {
          const result = await mcpClient.callTool(
            call.name ?? '',
            call.args as Record<string, unknown>,
          );
          return {
            functionResponse: {
              id: call.id,
              name: call.name ?? '',
              response: truncateIfNeeded(call.name ?? '', result) as Record<string, unknown>,
            },
          };
        } catch (error) {
          // Return the error as a tool response so the model can reason about the failure.
          return {
            functionResponse: {
              id: call.id,
              name: call.name ?? '',
              response: { error: String(error) },
            },
          };
        }
      }),
    );

    // Feed results back to the model; it will either answer or request more tool calls.
    response = await chat.sendMessage({ message: toolResults, config: requestConfig });
  }

  const text = response.text ?? '';
  // If the model still wants tool calls after MAX_ITERATIONS, surface a warning alongside the partial answer.
  const hitLimit = (response.functionCalls?.length ?? 0) > 0;
  return hitLimit
    ? text + '\n\n[Note: Query required too many steps. Some analysis may be incomplete.]'
    : text;
}
