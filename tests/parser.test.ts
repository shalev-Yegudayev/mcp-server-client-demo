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

describe('parseDbFile edge cases', () => {
  it('empty string throws ParseError with "Missing FORMAT"', () => {
    expect(() => parseDbFile('')).toThrow(ParseError);
    expect(() => parseDbFile('')).toThrow(/Missing FORMAT/);
  });

  it('only metadata with zero data rows returns empty rows array', () => {
    const raw = `# FORMAT: type|id|name\n# VERSION: 2.0\n`;
    const result = parseDbFile(raw);
    expect(result.rows).toHaveLength(0);
    expect(result.version).toBe('2.0');
    expect(result.columns).toEqual(['type', 'id', 'name']);
  });

  it('CRLF line endings parse correctly — name field has no trailing \\r', () => {
    const raw = `# FORMAT: type|id|name\r\n# VERSION: 1.0\r\nVENDOR|V1|Acme\r\n`;
    const result = parseDbFile(raw);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe('Acme');
  });

  it('data row before FORMAT throws ParseError about "before FORMAT"', () => {
    // VERSION appears first, a data row second — columns is still null at the data row
    const raw = `# VERSION: 1.0\nVENDOR|V1|x\n# FORMAT: type|id|name\n`;
    expect(() => parseDbFile(raw)).toThrow(ParseError);
    expect(() => parseDbFile(raw)).toThrow(/before FORMAT/);
  });

  it('empty field value in a data row is preserved as empty string', () => {
    // Third column (cve_id) is empty — valid, not an error
    const raw = `# FORMAT: type|id|cve_id|title\n# VERSION: 1.0\nVULN|X1||My Title\n`;
    const result = parseDbFile(raw);
    expect(result.rows[0].cve_id).toBe('');
    expect(result.rows[0].title).toBe('My Title');
  });

  it('leading whitespace in field values is preserved; trailing whitespace on the last field is stripped by line trim', () => {
    // line.trim() strips leading/trailing whitespace from the whole line before splitting,
    // so the last field loses any trailing space. Internal and leading spaces are preserved.
    const raw = `# FORMAT: type|id|name\n# VERSION: 1.0\nVENDOR|V1| Acme Corp \n`;
    const result = parseDbFile(raw);
    // Leading space on "name" field is preserved; trailing space is stripped by line.trim()
    expect(result.rows[0].name).toBe(' Acme Corp');
    expect(result.rows[0].id).toBe('V1');
  });
});
