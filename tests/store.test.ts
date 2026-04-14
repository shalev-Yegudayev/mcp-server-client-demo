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
