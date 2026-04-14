import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SEVERITIES, STATUSES } from '../store.js';
import type { Store } from '../store.js';
import { safeHandlerWithRateLimit, shapeVulnerability, shapeVendor } from './helpers.js';

const DEFAULT_LIMIT = 25;

const inputSchema = z.object({
  vendor_id: z.string().min(1).max(128),
  status: z.enum(STATUSES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

type Input = z.infer<typeof inputSchema>;

export function registerGetVendorVulnerabilities(server: McpServer, store: Store): void {
  server.registerTool(
    'get_vendor_vulnerabilities',
    {
      description:
        'Get all vulnerabilities for a specific vendor. ' +
        'Use when: analyst asks "show me all Linux Kernel CVEs" or "how many open Apache vulnerabilities exist?". ' +
        'Can filter by status (open/patched) and severity (critical/high/medium/low). ' +
        'Fast vendor-indexed lookup. Supports pagination.',
      inputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    safeHandlerWithRateLimit((args: Input) => {
      const offset = args.offset ?? 0;
      const limit = args.limit ?? DEFAULT_LIMIT;
      const vendor = store.vendorsById.get(args.vendor_id);
      if (!vendor) return { found: false, vendor_id: args.vendor_id };
      const pool = store.vulnsByVendorId.get(args.vendor_id) ?? [];
      const matched = pool.filter((v) => {
        if (args.status && v.status !== args.status) return false;
        if (args.severity && v.severity !== args.severity) return false;
        return true;
      });
      const results = matched.slice(offset, offset + limit);
      return {
        found: true,
        vendor: shapeVendor(vendor),
        total_matched: matched.length,
        returned: results.length,
        offset,
        limit,
        vulnerabilities: results.map((v) => shapeVulnerability(v, vendor)),
      };
    }),
  );
}
