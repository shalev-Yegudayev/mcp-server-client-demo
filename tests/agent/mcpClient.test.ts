import { McpClient } from '../../agent/mcpClient.js';

describe('McpClient', () => {
  describe('instance', () => {
    it('should be instantiable', () => {
      const client = new McpClient();
      expect(client).toBeDefined();
    });

    it('should have connect method', async () => {
      const client = new McpClient();
      expect(typeof client.connect).toBe('function');
    });

    it('should have disconnect method', async () => {
      const client = new McpClient();
      expect(typeof client.disconnect).toBe('function');
    });

    it('should have listTools method', async () => {
      const client = new McpClient();
      expect(typeof client.listTools).toBe('function');
    });

    it('should have callTool method', async () => {
      const client = new McpClient();
      expect(typeof client.callTool).toBe('function');
    });
  });

  describe('error handling', () => {
    it('should throw if listTools called before connect', async () => {
      const client = new McpClient();
      await expect(client.listTools()).rejects.toThrow('Client not connected');
    });

    it('should throw if callTool called before connect', async () => {
      const client = new McpClient();
      await expect(client.callTool('test_tool', {})).rejects.toThrow('Client not connected');
    });

    it('should handle disconnect gracefully', async () => {
      const client = new McpClient();
      // Should not throw when disconnecting without being connected
      await expect(client.disconnect()).resolves.toBeUndefined();
    });
  });
});

describe('McpClient behavior with injected SDK client', () => {
  it('callTool parses JSON from content[0].text when type is "text"', async () => {
    const mockSdkClient = {
      callTool: async () => ({
        content: [{ type: 'text', text: JSON.stringify({ found: true, id: 'X1' }) }],
      }),
    };
    const client = new McpClient();
    // Bypass connect() by directly assigning the private field
    (client as any).client = mockSdkClient;

    const result = await client.callTool('get_vulnerability_by_cve', {
      cve_id: 'CVE-2021-44228',
    });
    expect(result).toEqual({ found: true, id: 'X1' });
  });

  it('callTool returns raw result when content[0].type is not "text"', async () => {
    const rawResult = { content: [{ type: 'image', data: 'base64stuff' }] };
    const mockSdkClient = {
      callTool: async () => rawResult,
    };
    const client = new McpClient();
    (client as any).client = mockSdkClient;

    const result = await client.callTool('some_tool', {});
    expect(result).toBe(rawResult);
  });

  it('listTools shapes SDK response into name/description/inputSchema objects', async () => {
    const mockSdkClient = {
      listTools: async () => ({
        tools: [
          {
            name: 'search_vulnerabilities',
            description: 'Search for CVEs',
            inputSchema: { type: 'object', properties: {} },
          },
          {
            name: 'list_vendors',
            description: undefined, // missing description → should default to ''
            inputSchema: { type: 'object' },
          },
        ],
      }),
    };
    const client = new McpClient();
    (client as any).client = mockSdkClient;

    const tools = await client.listTools();
    expect(tools).toHaveLength(2);
    expect(tools[0]).toEqual({
      name: 'search_vulnerabilities',
      description: 'Search for CVEs',
      inputSchema: { type: 'object', properties: {} },
    });
    expect(tools[1].description).toBe('');
  });
});
