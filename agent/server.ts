import express, { type Request, type Response } from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import Bottleneck from 'bottleneck';
import { McpClient } from './mcpClient.js';
import { ask as askGemini } from './gemini.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

if (!process.env.GEMINI_API_KEY) {
  console.error(
    'Error: GEMINI_API_KEY environment variable is not set.\n' +
      'Get a free API key from: https://aistudio.google.com/app/apikey',
  );
  process.exit(1);
}

const app = express();
const port = parseInt(process.env.AGENT_PORT || '3000', 10);
const mcpClient = new McpClient();

// Per-IP rate limiting: 10 requests/minute, 1 concurrent per IP.
// The map is capped at MAX_IP_ENTRIES to prevent unbounded memory growth
// from clients with many unique IPs (e.g. proxies, scanners).
const MAX_REQUESTS_PER_MINUTE = 10;
const MAX_IP_ENTRIES = 1000;
const ipLimiters = new Map<string, Bottleneck>();

function getOrCreateLimiter(ip: string): Bottleneck {
  if (ipLimiters.has(ip)) return ipLimiters.get(ip)!;

  // Evict the oldest entry when the map is full to keep memory bounded.
  if (ipLimiters.size >= MAX_IP_ENTRIES) {
    const oldest = ipLimiters.keys().next().value;
    if (oldest !== undefined) ipLimiters.delete(oldest);
  }

  const limiter = new Bottleneck({
    minTime: 1000,
    maxConcurrent: 1,
    reservoir: MAX_REQUESTS_PER_MINUTE,
    reservoirRefreshAmount: MAX_REQUESTS_PER_MINUTE,
    reservoirRefreshInterval: 60 * 1000,
  });
  ipLimiters.set(ip, limiter);
  return limiter;
}

const REQUEST_TIMEOUT_MS = 30000;

function validateQuestion(question: string): { valid: boolean; error?: string } {
  const byteSize = Buffer.byteLength(question, 'utf8');
  if (byteSize > 8000) {
    return { valid: false, error: 'Question is too large. Please simplify.' };
  }

  // If normalized form is significantly shorter, original had excessive combining chars.
  const normalized = question.normalize('NFC');
  if (question.length > normalized.length * 2) {
    return { valid: false, error: 'Question contains suspicious Unicode sequences.' };
  }

  if (!/^[\p{L}\p{N}\p{P}\p{Z}\n\r\t]+$/gu.test(question)) {
    return { valid: false, error: 'Question contains invalid characters.' };
  }

  return { valid: true };
}

// Maps error message substrings to HTTP status + user-facing message.
// Order matters: more specific patterns first.
const ERROR_CLASSIFICATIONS: Array<{
  match: string[];
  status: number;
  message: string;
}> = [
  {
    match: ['ECONNREFUSED', 'ENOENT', 'connection timeout'],
    status: 503,
    message: 'Vulnerability database is unavailable. Please ensure the MCP server is running.',
  },
  {
    match: ['ENOTFOUND', 'getaddrinfo'],
    status: 503,
    message: 'Unable to reach the AI service. Please check your connection.',
  },
  {
    match: ['quota', 'resource'],
    status: 503,
    message: 'AI service is temporarily unavailable. Please try again later.',
  },
  {
    match: ['timeout'],
    status: 504,
    message: 'Request timed out. Please try a simpler question.',
  },
];

function classifyError(message: string): { status: number; userMessage: string } {
  for (const entry of ERROR_CLASSIFICATIONS) {
    if (entry.match.some((pattern) => message.includes(pattern))) {
      return { status: entry.status, userMessage: entry.message };
    }
  }
  return { status: 500, userMessage: 'An unexpected error occurred. Please try again.' };
}

app.use(express.json());

app.use('/api/ask', (req: Request, res: Response, next) => {
  const ip = (req.ip || req.socket?.remoteAddress || 'unknown').split(':').pop() || 'unknown';
  getOrCreateLimiter(ip)
    .schedule(async () => next())
    .catch(() => {
      res.status(429).json({
        error: `Rate limit exceeded. Maximum ${MAX_REQUESTS_PER_MINUTE} requests per minute.`,
      });
    });
});

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

  let timeoutHandle: NodeJS.Timeout | null = null;

  try {
    timeoutHandle = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({ error: 'Request took too long. Please try a simpler question.' });
      }
    }, REQUEST_TIMEOUT_MS);

    const answer = await askGemini(question, mcpClient);
    clearTimeout(timeoutHandle);
    res.json({ answer });
  } catch (error) {
    if (timeoutHandle) clearTimeout(timeoutHandle);

    const rawMessage = error instanceof Error ? error.message : String(error);
    console.error('Error processing question:', rawMessage);

    const { status, userMessage } = classifyError(rawMessage);
    res.status(status).json({ error: userMessage });
  }
});

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
