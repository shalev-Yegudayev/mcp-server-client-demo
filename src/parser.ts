const FORMAT_PREFIX = '# FORMAT:';
const VERSION_PREFIX = '# VERSION:';

export interface ParsedDb {
  columns: string[];
  version: string;
  rows: Record<string, string>[];
}

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly line?: number,
  ) {
    super(line !== undefined ? `Line ${line}: ${message}` : message);
    this.name = 'ParseError';
  }
}

export function parseDbFile(raw: string): ParsedDb {
  const lines = raw.split(/\r?\n/);
  let columns: string[] | null = null;
  let version: string | null = null;
  const rows: Record<string, string>[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lineNo = i + 1;

    if (trimmed === '') continue;

    if (trimmed.startsWith(FORMAT_PREFIX)) {
      const spec = trimmed.slice(FORMAT_PREFIX.length).trim();
      if (!spec) throw new ParseError('Empty FORMAT specification.', lineNo);
      columns = spec.split('|').map((c) => c.trim());
      if (columns.some((c) => c === '')) {
        throw new ParseError('FORMAT contains an empty column name.', lineNo);
      }
      if (new Set(columns).size !== columns.length) {
        throw new ParseError('FORMAT contains duplicate column names.', lineNo);
      }
      continue;
    }

    if (trimmed.startsWith(VERSION_PREFIX)) {
      version = trimmed.slice(VERSION_PREFIX.length).trim();
      if (!/^\d+\.\d+$/.test(version)) {
        throw new ParseError(`Invalid VERSION format: "${version}" (expected x.y).`, lineNo);
      }
      continue;
    }

    if (trimmed.startsWith('#')) continue;

    if (columns === null) {
      throw new ParseError('Data row encountered before FORMAT metadata.', lineNo);
    }

    const fields = trimmed.split('|');
    if (fields.length !== columns.length) {
      throw new ParseError(`Expected ${columns.length} columns, got ${fields.length}.`, lineNo);
    }

    const row: Record<string, string> = {};
    for (let c = 0; c < columns.length; c++) {
      row[columns[c]] = fields[c];
    }
    rows.push(row);
  }

  if (columns === null) throw new ParseError('Missing FORMAT metadata.');
  if (version === null) throw new ParseError('Missing VERSION metadata.');

  return { columns, version, rows };
}
