import Bottleneck from 'bottleneck';

// 100/s is generous for a single analyst session but slow enough that
// enumerating 10k records takes ~100s — making brute-force enumeration costly.
// 50 concurrent matches a reasonable LLM parallelism ceiling without exhausting the event loop.
const limiter = new Bottleneck({
  minTime: 10,
  maxConcurrent: 50,
  reservoir: 100,
  reservoirRefreshAmount: 100,
  reservoirRefreshInterval: 1000,
});

export function withRateLimit<T, R>(handler: (args: T) => R): (args: T) => Promise<Awaited<R>> {
  return (args: T) => limiter.schedule(() => Promise.resolve(handler(args)));
}

