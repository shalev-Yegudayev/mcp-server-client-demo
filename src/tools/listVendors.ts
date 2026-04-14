import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Store } from '../store.js';
import { safeHandlerWithRateLimit, shapeVendor } from './helpers.js';

const DEFAULT_LIMIT = 25;

const inputSchema = {
  category: z.string().min(1).max(128).optional(),
  name_contains: z.string().min(1).max(128).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100).optional(),
};

export function registerListVendors(server: McpServer, store: Store): void {
  server.registerTool(
    'list_vendors',
    {
      description:
        'List vendors in the registry. ' +
        'Use when: analyst asks "which vendors are tracked?" or "show me all Microsoft products" or wants to explore vendors by category. ' +
        'Can filter by name (substring search) or category. ' +
        'Supports pagination for large result sets.',
      inputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    safeHandlerWithRateLimit(
      (args: { category?: string; name_contains?: string; offset?: number; limit?: number }) => {
        const offset = args.offset ?? 0;
        const limit = args.limit ?? DEFAULT_LIMIT;
        let matched = Array.from(store.vendorsById.values());
        if (args.category) {
          matched = matched.filter(
            (v) => v.category.toLowerCase() === args.category!.toLowerCase(),
          );
        }
        if (args.name_contains) {
          matched = matched.filter((v) =>
            v.name.toLowerCase().includes(args.name_contains!.toLowerCase()),
          );
        }
        const results = matched.slice(offset, offset + limit);
        return {
          total_matched: matched.length,
          returned: results.length,
          offset,
          limit,
          vendors: results.map(shapeVendor),
        };
      },
    ),
  );
}
