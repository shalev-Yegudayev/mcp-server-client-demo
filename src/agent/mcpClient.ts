import { spawn, type ChildProcess } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface ToolResponse {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export class McpClient {
  private client: Client | null = null;
  private process: ChildProcess | null = null;
  private transport: StdioClientTransport | null = null;

  // Connection timeout to prevent hanging
  private static readonly CONNECTION_TIMEOUT_MS = 5000; // 5 seconds

  async connect(): Promise<void> {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const serverPath = join(__dirname, '../../dist/index.js');

    this.process = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (!this.process.stdout || !this.process.stdin) {
      if (this.process) {
        this.process.kill('SIGKILL');
      }
      throw new Error('Failed to setup stdio pipes for MCP server');
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.transport = new StdioClientTransport({
        stdout: this.process.stdout,
        stdin: this.process.stdin,
      } as any);

      this.client = new Client({
        name: 'vulnerability-agent',
        version: '0.1.0',
      });

      // Set timeout on connection attempt
      const connectPromise = this.client.connect(this.transport);
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('MCP server connection timeout')),
          McpClient.CONNECTION_TIMEOUT_MS,
        ),
      );

      await Promise.race([connectPromise, timeoutPromise]);
    } catch (error) {
      // Cleanup on failure
      if (this.process) {
        this.process.kill('SIGTERM');
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            this.process?.kill('SIGKILL');
            resolve();
          }, 2000);
          this.process!.on('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        });
      }
      throw error;
    }
  }

  async listTools(): Promise<Tool[]> {
    if (!this.client) throw new Error('Client not connected');
    const response = await this.client.listTools();
    return response.tools.map((tool: ToolResponse) => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) throw new Error('Client not connected');
    const result = await this.client.callTool({
      name,
      arguments: args,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (result.content && Array.isArray(result.content) && result.content.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const content = result.content[0] as any;
      if (content.type === 'text') {
        return JSON.parse(content.text);
      }
    }
    return result;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
    }
    if (this.process) {
      this.process.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.process?.kill('SIGKILL');
          resolve();
        }, 5000);
        this.process!.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
  }
}
