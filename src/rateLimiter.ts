/**
 * Rate limiting module to prevent DoS attacks and resource exhaustion.
 *
 * Protects against:
 * - LLM clients enumerating the entire database via tool loops
 * - Resource exhaustion (CPU, memory) from excessive calls
 * - Context flooding (requesting massive result sets repeatedly)
 *
 * Strategy: Simple token-bucket rate limiter using bottleneck library.
 * Configuration: 100 calls/second globally across all tools.
 */

import Bottleneck from 'bottleneck';

// Global rate limiter: 100 calls per second
// This is per server instance; multiple instances would need distributed rate limiting (e.g., Redis)
const limiter = new Bottleneck({
  minTime: 10, // Minimum 10ms between calls (100/second)
  maxConcurrent: 50, // Allow up to 50 concurrent calls (prevents thundering herd)
  reservoir: 100, // Start with 100 tokens
  reservoirRefreshAmount: 100, // Refresh to 100 tokens every interval
  reservoirRefreshInterval: 1 * 1000, // Every 1 second
});

/**
 * Get current rate limiter stats for monitoring/debugging.
 */
export function getRateLimiterStats() {
  const counts = limiter.counts();
  return {
    queued: counts.QUEUED,
    executing: counts.EXECUTING,
    minTime: 10,
    callsPerSecond: 100,
    maxConcurrent: 50,
  };
}

/**
 * Wrap a handler function with rate limiting.
 * If rate limit is exceeded, returns an error response.
 */
export function withRateLimit<T>(handler: (args: T) => unknown): (args: T) => Promise<unknown> {
  return (args: T) => {
    // Schedule the handler to run, respecting rate limits
    // bottleneck.wrap() automatically handles queueing and rate limiting
    return limiter.schedule(() => Promise.resolve(handler(args)));
  };
}

/**
 * Alternative: Create a rate limiter-aware error response.
 * Use this if you want to reject requests immediately rather than queue them.
 */
export async function checkRateLimit(): Promise<{ allowed: boolean; message?: string }> {
  const stats = getRateLimiterStats();

  // If queue is building up significantly, warn the client
  if (stats.queued > 50) {
    return {
      allowed: false,
      message: `Rate limit exceeded. Server is busy. ${stats.queued} requests queued. Please try again in a moment.`,
    };
  }

  return { allowed: true };
}
