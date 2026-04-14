import { createServer, SERVER_NAME, SERVER_VERSION } from '../src/server.js';

describe('createServer', () => {
  it('builds an MCP server instance with the expected identity', () => {
    const server = createServer();
    expect(server).toBeDefined();
    expect(SERVER_NAME).toBe('vulnerability-registry');
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
