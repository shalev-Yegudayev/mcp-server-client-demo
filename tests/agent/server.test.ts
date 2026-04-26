import { jest } from '@jest/globals';
import request from 'supertest';

// ── ESM mock setup ────────────────────────────────────────────────────────────
jest.unstable_mockModule('../../agent/mcpClient.js', () => ({
  McpClient: jest.fn().mockImplementation(() => ({
    connect: jest.fn<() => Promise<any>>().mockResolvedValue(undefined),
    disconnect: jest.fn<() => Promise<any>>().mockResolvedValue(undefined),
    listTools: jest.fn<() => Promise<any>>().mockResolvedValue([]),
    callTool: jest.fn<() => Promise<any>>().mockResolvedValue({}),
  })),
}));

const { createApp } = await import('../../agent/server.js');

// ── suppress expected error logs ─────────────────────────────────────────────
beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

// ── helpers ───────────────────────────────────────────────────────────────────

function makeDeps(ask?: (...args: any[]) => Promise<string>) {
  const client = {
    connect: jest.fn<() => Promise<any>>(),
    disconnect: jest.fn<() => Promise<any>>(),
    listTools: jest.fn<() => Promise<any>>(),
    callTool: jest.fn<() => Promise<any>>(),
  };
  const askFn = ask ?? jest.fn<() => Promise<any>>().mockResolvedValue('Here is the answer.');
  return { client: client as any, ask: askFn };
}

// ── POST /api/ask ─────────────────────────────────────────────────────────────

describe('POST /api/ask', () => {
  it('200 with answer when askFn resolves', async () => {
    const deps = makeDeps();
    const app = createApp(deps);
    const res = await request(app).post('/api/ask').send({ question: 'What is Log4Shell?' });
    expect(res.status).toBe(200);
    expect(res.body.answer).toBe('Here is the answer.');
  });

  it('400 when question field is missing', async () => {
    const app = createApp(makeDeps());
    const res = await request(app).post('/api/ask').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/provide a question/i);
  });

  it('400 when question is whitespace-only', async () => {
    const app = createApp(makeDeps());
    const res = await request(app).post('/api/ask').send({ question: '   ' });
    expect(res.status).toBe(400);
  });

  it('400 when question exceeds 1000 characters', async () => {
    const app = createApp(makeDeps());
    const res = await request(app).post('/api/ask').send({ question: 'Q'.repeat(1001) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/max 1000 characters/i);
  });

  it('400 when question contains invalid characters (null byte)', async () => {
    const app = createApp(makeDeps());
    const res = await request(app)
      .post('/api/ask')
      .send({ question: 'hello' + String.fromCharCode(0) + 'world' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid characters/i);
  });

  it('504 when askFn throws a DOMException TimeoutError', async () => {
    const timeoutError = new DOMException('The operation was aborted.', 'TimeoutError');
    const deps = makeDeps(jest.fn<() => Promise<any>>().mockRejectedValue(timeoutError));
    const app = createApp(deps);
    const res = await request(app).post('/api/ask').send({ question: 'slow question' });
    expect(res.status).toBe(504);
    expect(res.body.error).toMatch(/too long/i);
  });

  it('503 when askFn throws ECONNREFUSED', async () => {
    const deps = makeDeps(
      jest
        .fn<() => Promise<any>>()
        .mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:3000')),
    );
    const app = createApp(deps);
    const res = await request(app).post('/api/ask').send({ question: 'any question' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/MCP server/i);
  });

  it('503 when askFn throws a quota error', async () => {
    const deps = makeDeps(
      jest.fn<() => Promise<any>>().mockRejectedValue(new Error('quota exceeded')),
    );
    const app = createApp(deps);
    const res = await request(app).post('/api/ask').send({ question: 'any question' });
    expect(res.status).toBe(503);
  });

  it('500 for unknown errors', async () => {
    const deps = makeDeps(
      jest
        .fn<() => Promise<any>>()
        .mockRejectedValue(new Error('something completely unknown XYZ')),
    );
    const app = createApp(deps);
    const res = await request(app).post('/api/ask').send({ question: 'any question' });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/unexpected error/i);
  });
});
