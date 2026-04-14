import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadStore } from './store.js';
import { registerTools } from './tools/index.js';

export const SERVER_NAME = 'vulnerability-registry';
export const SERVER_VERSION = '0.1.0';

// Resolve .db paths relative to the compiled file, so cwd does not matter.
// dist/server.js → ../ is repo root where the .db files live.
function defaultDataDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..');
}

export interface CreateServerOptions {
  vendorsPath?: string;
  vulnsPath?: string;
}

export function createServer(options: CreateServerOptions = {}): McpServer {
  const dataDir = defaultDataDir();
  const vendorsPath = options.vendorsPath ?? join(dataDir, 'vendors.db');
  const vulnsPath = options.vulnsPath ?? join(dataDir, 'vulnerabilities.db');

  const store = loadStore({ vendorsPath, vulnsPath });

  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerTools(server, store);

  return server;
}
