import { jest } from '@jest/globals';
import { buildStore } from '../src/store.js';

const VENDORS = `# FORMAT: type|id|name|category|hq|founded
# VERSION: 1.0
VENDOR|V1|Acme|Software|NYC|2001
VENDOR|V2|Globex|Open Source|SF|1998
`;

const VULNS = `# FORMAT: type|id|cve_id|title|vendor_id|severity|cvss_score|affected_versions|status|published
# VERSION: 1.0
VULN|X1|CVE-2021-44228|Log4Shell|V2|critical|10.0|2.0-2.14.1|patched|2021-12-10
VULN|X2|CVE-2022-12345|Test|V1|high|7.5|1.0|open|2022-01-01
`;

describe('buildStore', () => {
  it('indexes vendors and vulnerabilities', () => {
    const store = buildStore(VENDORS, VULNS);
    expect(store.vendorsById.size).toBe(2);
    expect(store.vulnerabilities).toHaveLength(2);
    expect(store.vulnsByVendorId.get('V1')).toHaveLength(1);
    expect(store.vulnsByCveId.get('CVE-2021-44228')?.title).toBe('Log4Shell');
  });

  it('rejects invalid severity', () => {
    const bad = VULNS.replace('critical', 'spicy');
    expect(() => buildStore(VENDORS, bad)).toThrow(/severity/);
  });

  it('rejects CVSS out of range', () => {
    const bad = VULNS.replace('10.0', '11.0');
    expect(() => buildStore(VENDORS, bad)).toThrow(/cvss_score/);
  });

  it('rejects malformed CVE id', () => {
    const bad = VULNS.replace('CVE-2021-44228', 'NOT-A-CVE');
    expect(() => buildStore(VENDORS, bad)).toThrow(/cve_id/);
  });

  it('rejects bad published date', () => {
    const bad = VULNS.replace('2021-12-10', '12/10/2021');
    expect(() => buildStore(VENDORS, bad)).toThrow(/published/);
  });

  it('drops orphan vulnerabilities and warns', () => {
    const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
    const withOrphan = VULNS + 'VULN|X3|CVE-2023-9999|Orphan|V99|low|1.0|any|open|2023-01-01\n';
    const store = buildStore(VENDORS, withOrphan);
    expect(store.vulnerabilities).toHaveLength(2);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/dropped 1 orphan/));
    warn.mockRestore();
  });

  it('rejects duplicate vendor ids', () => {
    const dup = VENDORS + 'VENDOR|V1|Dup|Software|LA|2010\n';
    expect(() => buildStore(dup, VULNS)).toThrow(/Duplicate vendor/);
  });
});

describe('buildStore index properties', () => {
  const VULNS_WITH_OPEN = `# FORMAT: type|id|cve_id|title|vendor_id|severity|cvss_score|affected_versions|status|published
# VERSION: 1.0
VULN|X1|CVE-2021-44228|Log4Shell|V2|critical|10.0|2.0-2.14.1|patched|2021-12-10
VULN|X2|CVE-2022-12345|OpenBug|V1|high|7.5|1.0|open|2022-01-01
VULN|X3|CVE-2023-11111|CritOpen|V1|critical|9.5|all|open|2023-06-01
`;

  it('openVulnsByScore contains only open vulnerabilities', () => {
    const store = buildStore(VENDORS, VULNS_WITH_OPEN);
    expect(store.openVulnsByScore.every((v) => v.status === 'open')).toBe(true);
    expect(store.openVulnsByScore).toHaveLength(2);
  });

  it('openVulnsByScore is pre-sorted by cvss_score descending', () => {
    const store = buildStore(VENDORS, VULNS_WITH_OPEN);
    const scores = store.openVulnsByScore.map((v) => v.cvss_score);
    for (let i = 0; i < scores.length - 1; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i + 1]);
    }
    expect(store.openVulnsByScore[0].cve_id).toBe('CVE-2023-11111');
  });

  it('SEVERITY_RANK is tiebreaker when two vulns share the same CVSS score', () => {
    const withTie =
      VULNS_WITH_OPEN + 'VULN|X4|CVE-2024-5555|TieBug|V1|high|9.5|1.0|open|2024-01-01\n';
    const store = buildStore(VENDORS, withTie);
    const tied = store.openVulnsByScore.filter((v) => v.cvss_score === 9.5);
    expect(tied).toHaveLength(2);
    expect(tied[0].severity).toBe('critical');
    expect(tied[1].severity).toBe('high');
  });

  it('meta.vendorsVersion and meta.vulnsVersion reflect the parsed file versions', () => {
    const store = buildStore(VENDORS, VULNS_WITH_OPEN);
    expect(store.meta.vendorsVersion).toBe('1.0');
    expect(store.meta.vulnsVersion).toBe('1.0');
  });

  it('meta versions are tracked independently per file', () => {
    const vendors2 = VENDORS.replace('# VERSION: 1.0', '# VERSION: 2.3');
    const vulns5 = VULNS_WITH_OPEN.replace('# VERSION: 1.0', '# VERSION: 5.1');
    const store = buildStore(vendors2, vulns5);
    expect(store.meta.vendorsVersion).toBe('2.3');
    expect(store.meta.vulnsVersion).toBe('5.1');
  });

  it('duplicate CVE ID throws "Duplicate cve_id"', () => {
    const dupCve =
      VULNS_WITH_OPEN + 'VULN|X9|CVE-2021-44228|DupShell|V1|low|1.0|all|open|2023-01-01\n';
    expect(() => buildStore(VENDORS, dupCve)).toThrow(/Duplicate cve_id/);
  });

  it('empty vulnerabilities dataset produces valid store with empty collections', () => {
    const emptyVulns = `# FORMAT: type|id|cve_id|title|vendor_id|severity|cvss_score|affected_versions|status|published
# VERSION: 1.0
`;
    const store = buildStore(VENDORS, emptyVulns);
    expect(store.vulnerabilities).toHaveLength(0);
    expect(store.vulnsByVendorId.size).toBe(0);
    expect(store.vulnsByCveId.size).toBe(0);
    expect(store.openVulnsByScore).toHaveLength(0);
  });
});
