import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawn, type ChildProcess } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// How long to wait for the MCP server to accept a connection before giving up.
const CONNECTION_TIMEOUT_MS = 5000;
// How long to wait for the process to exit gracefully before sending SIGKILL.
const KILL_GRACE_PERIOD_MS = 5000;

export class McpClient {
  private client: Client | null = null;
  private process: ChildProcess | null = null;
  private transport: StdioClientTransport | null = null;

  async connect(): Promise<void> {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const serverPath = join(__dirname, '../../dist/index.js');

    this.process = spawn('node', [serverPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (!this.process.stdout || !this.process.stdin) {
      this.process.kill('SIGKILL');
      throw new Error('Failed to setup stdio pipes for MCP server');
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.transport = new StdioClientTransport({
        stdout: this.process.stdout,
        stdin: this.process.stdin,
      } as any);

      this.client = new Client({ name: 'vulnerability-agent', version: '0.1.0' });

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
      await this.killProcess();
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const first = content[0] as any;
      if (first?.type === 'text') return JSON.parse(first.text);
    }
    return result;
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
    }
    await this.killProcess();
  }

  private async killProcess(): Promise<void> {
    if (!this.process) return;
    this.process.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.process?.kill('SIGKILL');
        resolve();
      }, KILL_GRACE_PERIOD_MS);
      this.process!.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
}
