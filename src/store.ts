import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { parseDbFile } from './parser.js';

export const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export const STATUSES = ['open', 'patched'] as const;
export type Status = (typeof STATUSES)[number];

const YEAR_RE = /^\d{4}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CVE_RE = /^CVE-\d{4}-\d{4,7}$/;

export const VendorSchema = z.object({
  type: z.string().min(1),
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  hq: z.string().min(1),
  founded: z.string().regex(YEAR_RE, 'founded must be a 4-digit year'),
});
export type Vendor = z.infer<typeof VendorSchema>;

export const VulnerabilitySchema = z.object({
  type: z.string().min(1),
  id: z.string().min(1),
  cve_id: z.string().regex(CVE_RE, 'cve_id must match CVE-YYYY-NNNN'),
  title: z.string().min(1),
  vendor_id: z.string().min(1),
  severity: z.enum(SEVERITIES),
  cvss_score: z.coerce.number().min(0).max(10),
  affected_versions: z.string(),
  status: z.enum(STATUSES),
  published: z.string().regex(DATE_RE, 'published must be YYYY-MM-DD'),
});
export type Vulnerability = z.infer<typeof VulnerabilitySchema>;

export interface Store {
  vendorsById: Map<string, Vendor>;
  vulnerabilities: Vulnerability[];
  vulnsByVendorId: Map<string, Vulnerability[]>;
  vulnsByCveId: Map<string, Vulnerability>;
  /** Open vulnerabilities pre-sorted by cvss_score desc (SEVERITY_RANK as tiebreaker). */
  openVulnsByScore: Vulnerability[];
  meta: { vendorsVersion: string; vulnsVersion: string };
}

export interface LoadStoreOptions {
  vendorsPath: string;
  vulnsPath: string;
}

function validateRows<T>(rows: Record<string, string>[], schema: z.ZodType<T>, label: string): T[] {
  return rows.map((row, idx) => {
    const result = schema.safeParse(row);
    if (!result.success) {
      // Surface first issue with row context so startup failure is diagnosable.
      const issue = result.error.issues[0];
      throw new Error(
        `Invalid ${label} row ${idx + 1} (${row.id ?? '<no id>'}): ${issue.path.join('.')} — ${issue.message}`,
      );
    }
    return result.data;
  });
}

export function loadStore(opts: LoadStoreOptions): Store {
  const vendorsRaw = readFileSync(opts.vendorsPath, 'utf8');
  const vulnsRaw = readFileSync(opts.vulnsPath, 'utf8');
  return buildStore(vendorsRaw, vulnsRaw);
}

export function buildStore(vendorsRaw: string, vulnsRaw: string): Store {
  const vendorsParsed = parseDbFile(vendorsRaw);
  const vulnsParsed = parseDbFile(vulnsRaw);

  const vendors = validateRows(vendorsParsed.rows, VendorSchema, 'vendor');
  const vulnerabilitiesAll = validateRows(vulnsParsed.rows, VulnerabilitySchema, 'vulnerability');

  const vendorsById = new Map<string, Vendor>();
  for (const v of vendors) {
    if (vendorsById.has(v.id)) {
      throw new Error(`Duplicate vendor id: ${v.id}`);
    }
    vendorsById.set(v.id, v);
  }

  // Ignore orphan(no vendor_id) records.
  const vulnerabilities: Vulnerability[] = [];
  let orphanCount = 0;
  for (const v of vulnerabilitiesAll) {
    if (!vendorsById.has(v.vendor_id)) {
      orphanCount++;
      continue;
    }
    vulnerabilities.push(v);
  }
  if (orphanCount > 0) {
    console.error(
      `Startup: dropped ${orphanCount} orphan vulnerabilities referencing unknown vendor_ids`,
    );
  }

  const vulnsByVendorId = new Map<string, Vulnerability[]>();
  const vulnsByCveId = new Map<string, Vulnerability>();
  for (const v of vulnerabilities) {
    const bucket = vulnsByVendorId.get(v.vendor_id) ?? [];
    bucket.push(v);
    vulnsByVendorId.set(v.vendor_id, bucket);

    const key = v.cve_id.toUpperCase();
    if (vulnsByCveId.has(key)) {
      throw new Error(`Duplicate cve_id: ${v.cve_id}`);
    }
    vulnsByCveId.set(key, v);
  }

  const openVulnsByScore = vulnerabilities
    .filter((v) => v.status === 'open')
    .sort(
      (a, b) =>
        b.cvss_score - a.cvss_score || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
    );

  return {
    vendorsById,
    vulnerabilities,
    vulnsByVendorId,
    vulnsByCveId,
    openVulnsByScore,
    meta: {
      vendorsVersion: vendorsParsed.version,
      vulnsVersion: vulnsParsed.version,
    },
  };
}
