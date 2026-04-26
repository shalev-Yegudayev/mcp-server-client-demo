import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { TextContent } from '@modelcontextprotocol/sdk/types.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// How long to wait for the MCP server to accept a connection before giving up.
const CONNECTION_TIMEOUT_MS = 5000;

export class McpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  async connect(): Promise<void> {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const serverPath = join(__dirname, '../../dist/index.js');

    // SDK v1.x spawns the process internally — pass command+args, not pre-piped streams.
    this.transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath],
      stderr: 'inherit', // surface MCP server errors in the agent terminal
    });

    this.client = new Client({ name: 'vulnerability-agent', version: '0.1.0' });

    try {
      await Promise.race([
        this.client.connect(this.transport),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('MCP server connection timeout')),
            CONNECTION_TIMEOUT_MS,
          ),
        ),
      ]);
    } catch (error) {
      await this.transport.close();
      this.client = null;
      this.transport = null;
      throw error;
    }
  }

  async listTools(): Promise<Tool[]> {
    if (!this.client) throw new Error('Client not connected');
    const response = await this.client.listTools();
    return response.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) throw new Error('Client not connected');
    const result = await this.client.callTool({ name, arguments: args });

    const content = result.content;
    if (Array.isArray(content) && content.length > 0) {
      const first = content[0] as TextContent;
      if (first.type === 'text') return JSON.parse(first.text);
    }
    return result;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
  }
}
