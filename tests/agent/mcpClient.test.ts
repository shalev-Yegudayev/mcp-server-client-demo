import { jest } from '@jest/globals';
import { McpClient } from '../../src/agent/mcpClient.js';

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
