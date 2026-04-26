import {
  EnhancedGenerateContentResponse,
  GoogleGenerativeAI,
  type FunctionDeclaration,
} from '@google/generative-ai';
import type { McpClient } from './mcpClient.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';

// 8 KB ≈ 2k tokens at ~4 bytes/token; keeps Gemini context manageable per tool call.
const MAX_TOOL_RESULT_BYTES = 8192;

const MAX_ITERATIONS = parseInt(process.env.GEMINI_MAX_ITERATIONS ?? '10', 10);

// Gemini's FunctionDeclarationSchema is a strict subset of JSON Schema.
// Strip fields it rejects ($schema, additionalProperties, etc.) before sending.
const ALLOWED_SCHEMA_KEYS = new Set([
  'type',
  'description',
  'properties',
  'required',
  'items',
  'enum',
  'format',
  'nullable',
]);

export function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([key]) => ALLOWED_SCHEMA_KEYS.has(key))
      .map(([key, value]) => {
        if (key === 'properties' && value && typeof value === 'object') {
          return [
            key,
            Object.fromEntries(
              Object.entries(value as Record<string, unknown>).map(([k, v]) => [
                k,
                toGeminiSchema(v as Record<string, unknown>),
              ]),
            ),
          ];
        }
        if (key === 'items' && value && typeof value === 'object') {
          return [key, toGeminiSchema(value as Record<string, unknown>)];
        }
        return [key, value];
      }),
  );
}

function buildFunctionDeclarations(tools: Tool[]): FunctionDeclaration[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parameters: toGeminiSchema(tool.inputSchema) as any,
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

export async function ask(question: string, mcpClient: McpClient): Promise<string> {
  // Fetch available MCP tools and register them with the model so Gemini knows what it can call.
  const tools = await mcpClient.listTools();

  const model = gemini.getGenerativeModel({
    model: GEMINI_MODEL,
    tools: [{ functionDeclarations: buildFunctionDeclarations(tools) }],
    systemInstruction: SYSTEM_PROMPT,
  });

  // Each call to sendMessage appends to history automatically — no manual tracking needed.
  const chat = model.startChat({ history: [] });

  // Send the user's question. .response holds the model's first reply (text or tool calls).
  let response: EnhancedGenerateContentResponse = (await chat.sendMessage(question)).response;

  // Agentic loop: keep executing tool calls until the model stops requesting them or we hit the limit.
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const functionCalls = response.functionCalls();
    if (!functionCalls || functionCalls.length === 0) break;

    // Execute all requested tool calls in parallel, capping each result to MAX_TOOL_RESULT_BYTES.
    const toolResults = await Promise.all(
      functionCalls.map(async (call) => {
        try {
          const result = await mcpClient.callTool(call.name, call.args as Record<string, unknown>);
          return { name: call.name, response: truncateIfNeeded(call.name, result) };
        } catch (error) {
          // Return the error as a tool response so the model can reason about the failure.
          return { name: call.name, response: { error: String(error) } };
        }
      }),
    );

    // Feed results back to the model; it will either answer or request more tool calls.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    response = (
      await chat.sendMessage(
        toolResults.map(
          (tr) => ({ functionResponse: { name: tr.name, response: tr.response } }) as any,
        ),
      )
    ).response;
  }

  const text = response.text();
  // If the model still wants tool calls after MAX_ITERATIONS, surface a warning alongside the partial answer.
  const hitLimit = (response.functionCalls()?.length ?? 0) > 0;
  return hitLimit
    ? text + '\n\n[Note: Query required too many steps. Some analysis may be incomplete.]'
    : text;
}
