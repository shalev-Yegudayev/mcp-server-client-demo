import { GoogleGenerativeAI, type FunctionDeclaration } from '@google/generative-ai';
import type { McpClient } from './mcpClient.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite';

// 8 KB ≈ 2k tokens at ~4 bytes/token; keeps Gemini context manageable per tool call.
const MAX_TOOL_RESULT_BYTES = 8192;

const MAX_ITERATIONS = 10;

// Gemini's FunctionDeclarationSchema is a strict subset of JSON Schema.
// Strip fields it rejects ($schema, additionalProperties, etc.) before sending.
export function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const allowed = new Set([
    'type',
    'description',
    'properties',
    'required',
    'items',
    'enum',
    'format',
    'nullable',
  ]);
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(schema)) {
    if (!allowed.has(key)) continue;
    const value = schema[key];
    if (key === 'properties' && value && typeof value === 'object') {
      const cleaned: Record<string, unknown> = {};
      for (const [propKey, propVal] of Object.entries(value as Record<string, unknown>)) {
        cleaned[propKey] = toGeminiSchema(propVal as Record<string, unknown>);
      }
      result[key] = cleaned;
    } else if (key === 'items' && value && typeof value === 'object') {
      result[key] = toGeminiSchema(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
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
  const tools = await mcpClient.listTools();

  const model = gemini.getGenerativeModel({
    model: GEMINI_MODEL,
    tools: [{ functionDeclarations: buildFunctionDeclarations(tools) }],
    systemInstruction: SYSTEM_PROMPT,
  });

  const chat = model.startChat({ history: [] });

  // sendMessage returns GenerateContentResult; functionCalls/text live on .response
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let response: any = (await chat.sendMessage(question)).response;

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
    response = (
      await chat.sendMessage(
        toolResults.map(
          (tr) => ({ functionResponse: { name: tr.name, response: tr.response } }) as any,
        ),
      )
    ).response;
  }

  const text = response.text();
  const hitLimit = response.functionCalls()?.length > 0;
  return hitLimit
    ? text + '\n\n[Note: Query required too many steps. Some analysis may be incomplete.]'
    : text;
}
