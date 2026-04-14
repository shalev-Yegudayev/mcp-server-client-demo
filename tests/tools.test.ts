import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { buildStore } from '../src/store.js';
import { registerTools } from '../src/tools/index.js';
import { callTool, parseResult } from './helpers/callTool.js';

const VENDORS = `# FORMAT: type|id|name|category|hq|founded
# VERSION: 1.0
VENDOR|V1|Acme|Software|NYC|2001
VENDOR|V2|Globex|Open Source|SF|1998
`;

const VULNS = `# FORMAT: type|id|cve_id|title|vendor_id|severity|cvss_score|affected_versions|status|published
# VERSION: 1.0
VULN|X1|CVE-2021-44228|Log4Shell|V2|critical|10.0|2.0-2.14.1|patched|2021-12-10
VULN|X2|CVE-2022-12345|OpenBug|V1|high|7.5|1.0|open|2022-01-01
VULN|X3|CVE-2023-11111|CritOpen|V1|critical|9.5|all|open|2023-06-01
`;

function buildServer() {
  const store = buildStore(VENDORS, VULNS);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerTools(server, store);
  return server;
}

describe('tools', () => {
  const server = buildServer();

  // ── get_vulnerability_by_cve ──────────────────────────────────────────────

  it('get_vulnerability_by_cve returns enriched hit', async () => {
    const res = parseResult(
      await callTool(server, 'get_vulnerability_by_cve', { cve_id: 'CVE-2021-44228' }),
    ) as any;
    expect(res.found).toBe(true);
    expect(res.vulnerability.vendor.name).toBe('Globex');
  });

  it('get_vulnerability_by_cve returns not-found cleanly', async () => {
    const res = parseResult(
      await callTool(server, 'get_vulnerability_by_cve', { cve_id: 'CVE-9999-0001' }),
    ) as any;
    expect(res.found).toBe(false);
  });

  // ── search_vulnerabilities ────────────────────────────────────────────────

  it('search_vulnerabilities filters by severity + status', async () => {
    const res = parseResult(
      await callTool(server, 'search_vulnerabilities', { severity: 'critical', status: 'open' }),
    ) as any;
    expect(res.total_matched).toBe(1);
    expect(res.results[0].cve_id).toBe('CVE-2023-11111');
  });

  it('search_vulnerabilities filters by min_cvss', async () => {
    const res = parseResult(
      await callTool(server, 'search_vulnerabilities', { min_cvss: 9.0 }),
    ) as any;
    // CVE-2021-44228 (10.0) and CVE-2023-11111 (9.5) qualify; CVE-2022-12345 (7.5) does not
    expect(res.total_matched).toBe(2);
    expect(res.results.every((v: any) => v.cvss_score >= 9.0)).toBe(true);
  });

  it('search_vulnerabilities filters by max_cvss', async () => {
    const res = parseResult(
      await callTool(server, 'search_vulnerabilities', { max_cvss: 8.0 }),
    ) as any;
    expect(res.total_matched).toBe(1);
    expect(res.results[0].cve_id).toBe('CVE-2022-12345');
  });

  it('search_vulnerabilities filters by published_from', async () => {
    const res = parseResult(
      await callTool(server, 'search_vulnerabilities', { published_from: '2023-01-01' }),
    ) as any;
    expect(res.total_matched).toBe(1);
    expect(res.results[0].cve_id).toBe('CVE-2023-11111');
  });

  it('search_vulnerabilities filters by published_to', async () => {
    const res = parseResult(
      await callTool(server, 'search_vulnerabilities', { published_to: '2021-12-31' }),
    ) as any;
    expect(res.total_matched).toBe(1);
    expect(res.results[0].cve_id).toBe('CVE-2021-44228');
  });

  it('search_vulnerabilities filters by date range', async () => {
    const res = parseResult(
      await callTool(server, 'search_vulnerabilities', {
        published_from: '2022-01-01',
        published_to: '2022-12-31',
      }),
    ) as any;
    expect(res.total_matched).toBe(1);
    expect(res.results[0].cve_id).toBe('CVE-2022-12345');
  });

  // ── list_vendors ──────────────────────────────────────────────────────────

  it('list_vendors filters by category', async () => {
    const res = parseResult(
      await callTool(server, 'list_vendors', { category: 'Software' }),
    ) as any;
    expect(res.total_matched).toBe(1);
    expect(res.vendors[0].name).toBe('Acme');
  });

  // ── get_vendor_vulnerabilities ────────────────────────────────────────────

  it('get_vendor_vulnerabilities returns scoped list', async () => {
    const res = parseResult(
      await callTool(server, 'get_vendor_vulnerabilities', { vendor_id: 'V1' }),
    ) as any;
    expect(res.found).toBe(true);
    expect(res.total_matched).toBe(2);
  });

  it('get_vendor_vulnerabilities unknown vendor', async () => {
    const res = parseResult(
      await callTool(server, 'get_vendor_vulnerabilities', { vendor_id: 'V999' }),
    ) as any;
    expect(res.found).toBe(false);
  });

  // ── vulnerability_stats ───────────────────────────────────────────────────

  it('vulnerability_stats groups by severity', async () => {
    const res = parseResult(
      await callTool(server, 'vulnerability_stats', { group_by: 'severity' }),
    ) as any;
    expect(res.total).toBe(3);
    const crit = res.buckets.find((b: any) => b.key === 'critical');
    expect(crit.count).toBe(2);
  });

  it('vulnerability_stats groups by status', async () => {
    const res = parseResult(
      await callTool(server, 'vulnerability_stats', { group_by: 'status' }),
    ) as any;
    const open = res.buckets.find((b: any) => b.key === 'open');
    expect(open.count).toBe(2);
  });

  it('vulnerability_stats groups by year', async () => {
    const res = parseResult(
      await callTool(server, 'vulnerability_stats', { group_by: 'year' }),
    ) as any;
    const y2021 = res.buckets.find((b: any) => b.key === '2021');
    expect(y2021.count).toBe(1);
  });

  it('vulnerability_stats groups by vendor', async () => {
    const res = parseResult(
      await callTool(server, 'vulnerability_stats', { group_by: 'vendor' }),
    ) as any;
    const acme = res.buckets.find((b: any) => b.key === 'Acme');
    expect(acme.count).toBe(2);
  });

  // ── top_critical_open ─────────────────────────────────────────────────────

  it('top_critical_open sorts by CVSS desc among open only', async () => {
    const res = parseResult(await callTool(server, 'top_critical_open', { limit: 5 })) as any;
    expect(res.results).toHaveLength(2);
    // CVE-2023-11111 (9.5) must rank above CVE-2022-12345 (7.5)
    expect(res.results[0].cve_id).toBe('CVE-2023-11111');
    expect(res.results.every((v: any) => v.status === 'open')).toBe(true);
  });

  it('top_critical_open respects limit', async () => {
    const res = parseResult(await callTool(server, 'top_critical_open', { limit: 1 })) as any;
    expect(res.results).toHaveLength(1);
    expect(res.results[0].cve_id).toBe('CVE-2023-11111');
  });
});
