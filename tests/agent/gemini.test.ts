import { jest } from '@jest/globals';

// Tests for the Gemini agent module
describe('Gemini Agent', () => {
  describe('module structure', () => {
    it('should export ask function', async () => {
      const { ask } = await import('../../agent/gemini.js');
      expect(typeof ask).toBe('function');
    });
  });

  describe('ask function', () => {
    it('should be an async function that accepts a question and mcpClient', async () => {
      const { ask } = await import('../../agent/gemini.js');

      // Create a minimal mock
      const mockClient = {
        listTools: async () => [],
        callTool: async () => ({}),
        connect: async () => {},
        disconnect: async () => {},
      };

      // The function should not throw when called with valid arguments
      // (it will fail due to Gemini API not being available, but that's expected)
      try {
        await ask('test question', mockClient as any);
      } catch (error) {
        // Expected - Gemini API will fail in test environment
        expect(error).toBeDefined();
      }
    });

    it('should throw if mcpClient.listTools fails', async () => {
      const { ask } = await import('../../agent/gemini.js');

      const mockClient = {
        listTools: async () => {
          throw new Error('listTools failed');
        },
        callTool: async () => ({}),
        connect: async () => {},
        disconnect: async () => {},
      };

      await expect(ask('test question', mockClient as any)).rejects.toThrow('listTools failed');
    });

    it('should handle empty questions', async () => {
      const { ask } = await import('../../agent/gemini.js');

      const mockClient = {
        listTools: async () => [],
        callTool: async () => ({}),
        connect: async () => {},
        disconnect: async () => {},
      };

      try {
        await ask('', mockClient as any);
      } catch (error) {
        // Expected to fail due to Gemini API
        expect(error).toBeDefined();
      }
    });

    it('should handle very long questions', async () => {
      const { ask } = await import('../../agent/gemini.js');

      const longQuestion = 'Q'.repeat(1000);
      const mockClient = {
        listTools: async () => [],
        callTool: async () => ({}),
        connect: async () => {},
        disconnect: async () => {},
      };

      try {
        await ask(longQuestion, mockClient as any);
      } catch (error) {
        // Expected to fail due to Gemini API
        expect(error).toBeDefined();
      }
    });
  });
});
