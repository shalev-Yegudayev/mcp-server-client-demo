#!/usr/bin/env node
import { createServer } from './server.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  // stderr is safe: stdout is reserved for the MCP protocol on stdio transport.
  console.error('Fatal error starting MCP server:', err);
  process.exit(1);
});
