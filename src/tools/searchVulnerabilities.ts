import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SEVERITIES, STATUSES } from '../store.js';
import type { Store } from '../store.js';
import { safeHandlerWithRateLimit, shapeVulnerability } from './helpers.js';

const DEFAULT_LIMIT = 25;

const inputSchema = z.object({
  severity: z.enum(SEVERITIES).optional(),
    status: z.enum(STATUSES).optional(),
    vendor_id: z.string().min(1).max(128).optional(),
    min_cvss: z.number().min(0).max(10).optional(),
    max_cvss: z.number().min(0).max(10).optional(),
    published_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
      .optional(),
    published_to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
      .optional(),
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .refine(
    (args) =>
      !(
        args.min_cvss !== undefined &&
        args.max_cvss !== undefined &&
        args.min_cvss > args.max_cvss
      ),
    {
      message: 'min_cvss must be less than or equal to max_cvss',
    },
  )
  .refine(
    (args) =>
      !(args.published_from && args.published_to && args.published_from > args.published_to),
    {
      message: 'published_from must be less than or equal to published_to',
    },
  );

type Input = z.infer<typeof inputSchema>;

export function registerSearchVulnerabilities(server: McpServer, store: Store): void {
  server.registerTool(
    'search_vulnerabilities',
    {
      description:
        'Search for vulnerabilities matching specific criteria (severity, status, CVSS, date, vendor). ' +
        'Use when: filtering by multiple dimensions, finding vulns in a date range, or searching across multiple vendors. ' +
        'Example: "Show all critical vulns from 2024 that are still open". ' +
        'Returns affected_versions as free text; supports pagination.',
      inputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    safeHandlerWithRateLimit((args: Input) => {
        const offset = args.offset ?? 0;
        const limit = args.limit ?? DEFAULT_LIMIT;
        const pool = args.vendor_id
          ? (store.vulnsByVendorId.get(args.vendor_id) ?? [])
          : store.vulnerabilities;
        const matched = pool.filter((v) => {
          if (args.severity && v.severity !== args.severity) return false;
          if (args.status && v.status !== args.status) return false;
          if (args.min_cvss !== undefined && v.cvss_score < args.min_cvss) return false;
          if (args.max_cvss !== undefined && v.cvss_score > args.max_cvss) return false;
          if (args.published_from && v.published < args.published_from) return false;
          if (args.published_to && v.published > args.published_to) return false;
          return true;
        });
        const results = matched
          .slice(offset, offset + limit)
          .map((v) => shapeVulnerability(v, store.vendorsById.get(v.vendor_id)));
        return {
          total_matched: matched.length,
          returned: results.length,
          offset,
          limit,
          results,
        };
      }),
  );
}
