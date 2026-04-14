import { GoogleGenerativeAI, type FunctionDeclaration } from '@google/generative-ai';
import type { McpClient } from './mcpClient.js';

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

function buildFunctionDeclarations(tools: Tool[]): FunctionDeclaration[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parameters: tool.inputSchema as any,
  }));
}

// Prevent cost explosion and context overflow from large tool results
const MAX_RESULT_SIZE_BYTES = 8192; // ~2000 tokens

function truncateResultIfNeeded(
  toolName: string,
  result: unknown,
): { result: unknown; wasTruncated: boolean } {
  const resultStr = JSON.stringify(result);
  const sizeBytes = Buffer.byteLength(resultStr, 'utf8');

  if (sizeBytes > MAX_RESULT_SIZE_BYTES) {
    console.warn(
      `Tool ${toolName} returned ${sizeBytes} bytes (max ${MAX_RESULT_SIZE_BYTES}). Truncating.`,
    );

    // If it's an array, return first 5 items with count
    if (Array.isArray(result)) {
      return {
        result: {
          truncated: true,
          totalItems: result.length,
          message: `Result contained ${result.length} items. Showing first 5. Use pagination to refine your query.`,
          items: result.slice(0, 5),
        },
        wasTruncated: true,
      };
    }

    // Otherwise return a warning
    return {
      result: {
        truncated: true,
        message: `Result was too large (${Math.round(sizeBytes / 1024)}KB). Please use more specific filters or pagination.`,
        sampleSize: Math.min(500, sizeBytes),
      },
      wasTruncated: true,
    };
  }

  return { result, wasTruncated: false };
}

export async function ask(question: string, mcpClient: McpClient): Promise<string> {
  const tools = await mcpClient.listTools();
  const functionDeclarations = buildFunctionDeclarations(tools);

  const model = gemini.getGenerativeModel({
    model: 'gemini-1.5-flash',
    tools: [{ functionDeclarations }],
  });

  const chat = model.startChat({
    history: [],
  });

  let iteration = 0;
  const maxIterations = 10;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let response: any = await chat.sendMessage(question);

  while (iteration < maxIterations) {
    const functionCalls = response.functionCalls();
    if (!functionCalls || functionCalls.length === 0) {
      break;
    }

    iteration++;

    // Execute all function calls in parallel
    const toolResults = await Promise.all(
      functionCalls.map(async (call: { name: string; args: Record<string, unknown> }) => {
        try {
          const result = await mcpClient.callTool(call.name, call.args);
          const { result: truncated, wasTruncated } = truncateResultIfNeeded(call.name, result);
          return {
            name: call.name,
            result: truncated,
            truncated: wasTruncated,
          };
        } catch (error) {
          return {
            name: call.name,
            error: String(error),
          };
        }
      }),
    );

    // Send tool results back to Gemini
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    response = await chat.sendMessage(
      toolResults.map(
        (tr) =>
          ({
            functionResponse: {
              name: tr.name,
              response: tr.result || { error: tr.error },
            },
          }) as any,
      ),
    );
  }

  if (iteration >= maxIterations) {
    return (
      response.text() +
      '\n\n[Note: Query required too many steps. Some analysis may be incomplete.]'
    );
  }

  return response.text();
}
