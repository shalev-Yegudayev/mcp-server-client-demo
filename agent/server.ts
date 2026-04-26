import express, { type Request, type Response, type Application } from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { McpClient } from './mcpClient.js';
import { ask as askGemini } from './gemini.js';
import { rateLimitMiddleware } from './rateLimiter.js';
import { validateQuestion, withTimeout, REQUEST_TIMEOUT_MS } from './validation.js';
import { classifyError } from './errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type AskFn = (question: string, client: McpClient) => Promise<string>;

export interface AppDeps {
  client?: McpClient;
  ask?: AskFn;
}

export function createApp(deps: AppDeps = {}): Application {
  const client = deps.client ?? new McpClient();
  const askFn = deps.ask ?? askGemini;

  const app = express();
  app.use(express.json());
  app.use('/api/ask', rateLimitMiddleware);
  app.use(express.static(join(__dirname, 'ui'), { index: 'index.html' }));

  app.post('/api/ask', async (req: Request, res: Response) => {
    const { question } = req.body as { question?: string };

    if (!question || typeof question !== 'string') {
      res.status(400).json({ error: 'Please provide a question.' });
      return;
    }

    if (question.trim().length === 0 || question.length > 1000) {
      res.status(400).json({ error: 'Please enter a question (max 1000 characters).' });
      return;
    }

    const validation = validateQuestion(question);
    if (!validation.valid) {
      res.status(400).json({ error: validation.error });
      return;
    }

    try {
      const answer = await withTimeout(askFn(question, client), REQUEST_TIMEOUT_MS);
      res.json({ answer });
    } catch (error) {
      const isDomTimeout = error instanceof DOMException && error.name === 'TimeoutError';
      if (isDomTimeout) {
        res.status(504).json({ error: 'Request took too long. Please try a simpler question.' });
        return;
      }

      const rawMessage = error instanceof Error ? error.message : String(error);
      console.error('Error processing question:', rawMessage);

      const { status, userMessage } = classifyError(rawMessage);
      res.status(status).json({ error: userMessage });
    }
  });

  return app;
}

// Only run startup when this module is the direct entry point, not when imported by tests.
if (process.env.NODE_ENV !== 'test') {
  if (!process.env.GEMINI_API_KEY) {
    console.error(
      'Error: GEMINI_API_KEY environment variable is not set.\n' +
        'Get a free API key from: https://aistudio.google.com/app/apikey',
    );
    process.exit(1);
  }

  const port = parseInt(process.env.AGENT_PORT || '3000', 10);
  const mcpClient = new McpClient();
  const app = createApp({ client: mcpClient });

  await mcpClient.connect();

  const server = app.listen(port, () => {
    console.log(
      `\n✓ Agent server running at http://localhost:${port}\n` +
        `  Open your browser and ask questions about vulnerabilities.\n` +
        `  Press Ctrl+C to stop.\n`,
    );
  });

  const SHUTDOWN_TIMEOUT_MS = 10000;
  let isShuttingDown = false;

  async function gracefulShutdown(): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log('\nGraceful shutdown initiated...');

    const timeoutHandle = setTimeout(() => {
      console.error('Shutdown timeout exceeded. Forcing exit.');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    try {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      console.log('HTTP server closed.');

      await mcpClient.disconnect();
      console.log('MCP client disconnected.');

      clearTimeout(timeoutHandle);
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      clearTimeout(timeoutHandle);
      process.exit(1);
    }
  }

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}
