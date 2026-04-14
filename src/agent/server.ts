import express, { type Request, type Response } from 'express';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import Bottleneck from 'bottleneck';
import { sanitizeForLLMSimple } from '../sanitization.js';
import { McpClient } from './mcpClient.js';
import { ask as askGemini } from './gemini.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Validate environment
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

// Per-IP rate limiting: prevent single client from consuming all quota
const ipLimiters = new Map<string, Bottleneck>();
const MAX_REQUESTS_PER_MINUTE = 10; // 10 requests per minute per IP

function getOrCreateLimiter(ip: string): Bottleneck {
  if (!ipLimiters.has(ip)) {
    ipLimiters.set(
      ip,
      new Bottleneck({
        minTime: 1000, // Min 1 second between requests from same IP
        maxConcurrent: 1, // Only 1 concurrent request per IP
        reservoir: MAX_REQUESTS_PER_MINUTE, // 10 requests
        reservoirRefreshAmount: MAX_REQUESTS_PER_MINUTE,
        reservoirRefreshInterval: 60 * 1000, // Per minute
      }),
    );
  }
  return ipLimiters.get(ip)!;
}

// Request timeout configuration
const REQUEST_TIMEOUT_MS = 30000; // 30 seconds

// Unicode validation to prevent combining diacritic abuse
function validateQuestion(question: string): { valid: boolean; error?: string } {
  // Check byte length (prevent encoding bloat)
  const byteSize = Buffer.byteLength(question, 'utf8');
  if (byteSize > 8000) {
    return { valid: false, error: 'Question is too large. Please simplify.' };
  }

  // Normalize to detect combining diacritic abuse
  // If normalized form is significantly shorter, original had excessive combining chars
  const normalized = question.normalize('NFC');
  if (question.length > normalized.length * 2) {
    return { valid: false, error: 'Question contains suspicious Unicode sequences.' };
  }

  // Check for invalid/control characters (allow common punctuation and whitespace)
  if (!/^[\p{L}\p{N}\p{P}\p{Z}\n\r\t]+$/gu.test(question)) {
    return { valid: false, error: 'Question contains invalid characters.' };
  }

  return { valid: true };
}

app.use(express.json());

// Per-IP rate limiting middleware for /api/ask
app.use('/api/ask', (req: Request, res: Response, next) => {
  const ip = (req.ip || req.socket?.remoteAddress || 'unknown').split(':').pop() || 'unknown';
  const limiter = getOrCreateLimiter(ip);

  limiter
    .schedule(async () => {
      next();
    })
    .catch(() => {
      res.status(429).json({
        error: `Rate limit exceeded. Maximum ${MAX_REQUESTS_PER_MINUTE} requests per minute.`,
      });
    });
});

// Serve the UI
app.get('/', (_req: Request, res: Response) => {
  try {
    const uiPath = join(__dirname, 'ui.html');
    const html = readFileSync(uiPath, 'utf-8');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    res.status(500).json({
      error: 'Unable to load the user interface. Please check your installation.',
    });
  }
});

// Handle questions
app.post('/api/ask', async (req: Request, res: Response) => {
  const { question } = req.body as { question?: string };

  if (!question || typeof question !== 'string') {
    res.status(400).json({
      error: 'Please provide a question.',
    });
    return;
  }

  if (question.trim().length === 0 || question.length > 1000) {
    res.status(400).json({
      error: 'Please enter a question (max 1000 characters).',
    });
    return;
  }

  // Validate Unicode integrity
  const validation = validateQuestion(question);
  if (!validation.valid) {
    res.status(400).json({
      error: validation.error,
    });
    return;
  }

  // Set request timeout to prevent hanging requests
  let timeoutHandle: NodeJS.Timeout | null = null;

  try {
    timeoutHandle = setTimeout(() => {
      if (!res.headersSent) {
        res.status(504).json({
          error: 'Request took too long. Please try a simpler question.',
        });
      }
    }, REQUEST_TIMEOUT_MS);

    const answer = await askGemini(question, mcpClient);
    clearTimeout(timeoutHandle);
    res.json({ answer });
  } catch (error) {
    if (timeoutHandle) clearTimeout(timeoutHandle);

    // Classify error and determine response
    const rawMessage = error instanceof Error ? error.message : String(error);
    const errorCode = error instanceof Error ? (error as any).code : undefined;
    console.error('Error processing question:', { rawMessage, errorCode });

    // User-friendly error messages (never leak raw error details)
    let statusCode = 500;
    let errorMessage = 'An unexpected error occurred. Please try again.';

    if (rawMessage.includes('quota') || rawMessage.includes('resource')) {
      statusCode = 503;
      errorMessage = 'AI service is temporarily unavailable. Please try again later.';
    } else if (
      rawMessage.includes('ECONNREFUSED') ||
      rawMessage.includes('ENOENT') ||
      rawMessage.includes('connection timeout')
    ) {
      statusCode = 503;
      errorMessage =
        'Vulnerability database is unavailable. Please ensure the MCP server is running.';
    } else if (rawMessage.includes('ENOTFOUND') || rawMessage.includes('getaddrinfo')) {
      statusCode = 503;
      errorMessage = 'Unable to reach the AI service. Please check your connection.';
    } else if (rawMessage.includes('timeout')) {
      statusCode = 504;
      errorMessage = 'Request timed out. Please try a simpler question.';
    }

    // Sanitize error message before returning (defense against injection in error messages)
    const sanitized = sanitizeForLLMSimple(errorMessage);

    res.status(statusCode).json({ error: sanitized });
  }
});

// Start server
let server = app.listen(port, () => {
  console.log(
    `\n✓ Agent server running at http://localhost:${port}\n` +
      `  Open your browser and ask questions about vulnerabilities.\n` +
      `  Press Ctrl+C to stop.\n`,
  );
});

// Graceful shutdown with timeout protection
const SHUTDOWN_TIMEOUT_MS = 10000;
let isShuttingDown = false;

async function gracefulShutdown(): Promise<void> {
  if (isShuttingDown) return; // Prevent double shutdown
  isShuttingDown = true;

  console.log('\nGraceful shutdown initiated...');

  // Set hard timeout upfront
  const timeoutHandle = setTimeout(() => {
    console.error('Shutdown timeout exceeded. Forcing exit.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    // Close HTTP server (stops accepting new requests)
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    console.log('HTTP server closed.');

    // Disconnect MCP client
    await mcpClient.disconnect();
    console.log('MCP client disconnected.');

    clearTimeout(timeoutHandle);
    console.log('Shutdown complete.');
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    clearTimeout(timeoutHandle);
    process.exit(1);
  }
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
