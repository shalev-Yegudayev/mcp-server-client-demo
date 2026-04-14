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

function parseFormat(spec: string, lineNo: number): string[] {
  if (!spec) throw new ParseError('Empty FORMAT specification.', lineNo);
  const columns = spec.split('|').map((c) => c.trim());
  if (columns.some((c) => c === '')) {
    throw new ParseError('FORMAT contains an empty column name.', lineNo);
  }
  if (new Set(columns).size !== columns.length) {
    throw new ParseError('FORMAT contains duplicate column names.', lineNo);
  }
  return columns;
}

function parseVersion(raw: string, lineNo: number): string {
  if (!/^\d+\.\d+$/.test(raw)) {
    throw new ParseError(`Invalid VERSION format: "${raw}" (expected x.y).`, lineNo);
  }
  return raw;
}

function parseRow(
  trimmed: string,
  columns: string[],
  lineNo: number,
): Record<string, string> {
  const fields = trimmed.split('|');
  if (fields.length !== columns.length) {
    throw new ParseError(`Expected ${columns.length} columns, got ${fields.length}.`, lineNo);
  }
  const row: Record<string, string> = {};
  for (let c = 0; c < columns.length; c++) {
    row[columns[c]] = fields[c];
  }
  return row;
}

export function parseDbFile(raw: string): ParsedDb {
  const lines = raw.split(/\r?\n/);
  let columns: string[] | null = null;
  let version: string | null = null;
  const rows: Record<string, string>[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const lineNo = i + 1;

    if (trimmed === '' || (trimmed.startsWith('#') && !trimmed.startsWith(FORMAT_PREFIX) && !trimmed.startsWith(VERSION_PREFIX))) continue;

    if (trimmed.startsWith(FORMAT_PREFIX)) {
      columns = parseFormat(trimmed.slice(FORMAT_PREFIX.length).trim(), lineNo);
      continue;
    }

    if (trimmed.startsWith(VERSION_PREFIX)) {
      version = parseVersion(trimmed.slice(VERSION_PREFIX.length).trim(), lineNo);
      continue;
    }

    if (columns === null) {
      throw new ParseError('Data row encountered before FORMAT metadata.', lineNo);
    }

    rows.push(parseRow(trimmed, columns, lineNo));
  }

  if (columns === null) throw new ParseError('Missing FORMAT metadata.');
  if (version === null) throw new ParseError('Missing VERSION metadata.');

  return { columns, version, rows };
}
