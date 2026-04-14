import { parseDbFile, ParseError } from '../src/parser.js';

const VALID = `# METADATA
# FORMAT: type|id|name
# VERSION: 1.0

VENDOR|V1|Acme
VENDOR|V2|Globex
`;

describe('parseDbFile', () => {
  it('parses format, version, and rows', () => {
    const result = parseDbFile(VALID);
    expect(result.columns).toEqual(['type', 'id', 'name']);
    expect(result.version).toBe('1.0');
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({ type: 'VENDOR', id: 'V1', name: 'Acme' });
  });

  it('retains unknown type values untouched (future-proof)', () => {
    const raw = `# FORMAT: type|id|name\n# VERSION: 1.1\nVENDOR_COMMERCIAL|V9|NewCo\n`;
    const result = parseDbFile(raw);
    expect(result.rows[0].type).toBe('VENDOR_COMMERCIAL');
  });

  it('throws when FORMAT is missing', () => {
    expect(() => parseDbFile('# VERSION: 1.0\nVENDOR|V1|x\n')).toThrow(ParseError);
  });

  it('throws when VERSION is missing', () => {
    expect(() => parseDbFile('# FORMAT: type|id\nVENDOR|V1\n')).toThrow(/VERSION/);
  });

  it('throws when column count mismatches', () => {
    const raw = `# FORMAT: type|id|name\n# VERSION: 1.0\nVENDOR|V1\n`;
    expect(() => parseDbFile(raw)).toThrow(/Expected 3 columns/);
  });

  it('rejects malformed VERSION', () => {
    const raw = `# FORMAT: type|id\n# VERSION: one-point-zero\nVENDOR|V1\n`;
    expect(() => parseDbFile(raw)).toThrow(/Invalid VERSION/);
  });

  it('rejects duplicate column names', () => {
    const raw = `# FORMAT: type|id|id\n# VERSION: 1.0\n`;
    expect(() => parseDbFile(raw)).toThrow(/duplicate column/);
  });
});
