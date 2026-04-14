import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Store } from '../store.js';
import { safeHandlerWithRateLimit, shapeVulnerability } from './helpers.js';

const inputSchema = {
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(50).optional(),
};

export function registerTopCriticalOpen(server: McpServer, store: Store): void {
  server.registerTool(
    'top_critical_open',
    {
      description:
        'Get the most critical open vulnerabilities ranked by CVSS score. ' +
        'Use when: analyst asks "What should I worry about right now?", "Show me the top risks", or "What are the highest-impact unpatched vulns?". ' +
        'This is your go-to tool for risk prioritization. ' +
        'Sorted by CVSS (highest first). Supports pagination for exploring top N.',
      inputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    safeHandlerWithRateLimit((args: { offset?: number; limit?: number }) => {
      const offset = args.offset ?? 0;
      const limit = args.limit ?? 10;
      // Uses pre-sorted index built at startup — O(1) slice, no per-call sort.
      const results = store.openVulnsByScore
        .slice(offset, offset + limit)
        .map((v) => shapeVulnerability(v, store.vendorsById.get(v.vendor_id)));
      return { returned: results.length, offset, limit, results };
    }),
  );
}
