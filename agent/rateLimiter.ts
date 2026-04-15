import type { Request, Response, NextFunction } from 'express';
import Bottleneck from 'bottleneck';

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

export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const ip = (req.ip || req.socket?.remoteAddress || 'unknown').split(':').pop() || 'unknown';
  getOrCreateLimiter(ip)
    .schedule(async () => next())
    .catch(() => {
      res.status(429).json({
        error: `Rate limit exceeded. Maximum ${MAX_REQUESTS_PER_MINUTE} requests per minute.`,
      });
    });
}
