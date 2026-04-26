import { jest } from '@jest/globals';

// ── ESM mock setup ────────────────────────────────────────────────────────────
// Must be called before any import that transitively loads @google/genai.
// jest.unstable_mockModule intercepts the module when gemini.ts is dynamically imported below.

const mockSendMessage = jest.fn<() => Promise<any>>();
const mockChatsCreate = jest.fn<() => any>(() => ({ sendMessage: mockSendMessage }));

jest.unstable_mockModule('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    chats: { create: mockChatsCreate },
  })),
}));

// Dynamic import AFTER mock registration — gemini.ts now loads with the mocked SDK.
const { ask, truncateIfNeeded } = await import('../../agent/gemini.js');

// ── truncateIfNeeded ──────────────────────────────────────────────────────────

describe('truncateIfNeeded', () => {
  it('returns the original object reference when it is under 8KB', () => {
    const small = { found: true, cve_id: 'CVE-2021-44228' };
    const result = truncateIfNeeded('test_tool', small);
    expect(result).toBe(small);
  });

  it('truncates an array over 8KB to first 5 items with truncated flag', () => {
    // ~100 items * ~100 bytes each ≈ 10KB → exceeds 8KB limit
    const bigArray = Array.from({ length: 100 }, (_, i) => ({
      cve_id: `CVE-2021-${String(i).padStart(5, '0')}`,
      title: 'A'.repeat(80),
    }));
    const result = truncateIfNeeded('search_vulnerabilities', bigArray) as any;
    expect(result.truncated).toBe(true);
    expect(result.items).toHaveLength(5);
    expect(result.totalItems).toBe(100);
    expect(result.message).toMatch(/first 5/i);
  });

  it('truncates a large non-array object with message only (no items key)', () => {
    const bigObj = { data: 'X'.repeat(9000) };
    const result = truncateIfNeeded('some_tool', bigObj) as any;
    expect(result.truncated).toBe(true);
    expect(result).not.toHaveProperty('items');
    expect(result.message).toMatch(/too large/i);
  });
});

// ── ask ───────────────────────────────────────────────────────────────────────

describe('ask', () => {
  beforeEach(() => {
    mockSendMessage.mockReset();
    mockChatsCreate.mockClear();
  });

  function makeMockClient(tools: unknown[] = []) {
    return {
      listTools: jest.fn<() => Promise<any>>().mockResolvedValue(tools),
      callTool: jest.fn<() => Promise<any>>().mockResolvedValue({ found: true }),
    };
  }

  it('no tool calls → returns response text directly', async () => {
    mockSendMessage.mockResolvedValue({ functionCalls: [], text: 'Here is the answer' });

    const client = makeMockClient();
    const result = await ask('What is CVE-2021-44228?', client as any);

    expect(result).toBe('Here is the answer');
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it('one round of tool calls → tool result sent back → returns final text', async () => {
    mockSendMessage
      .mockResolvedValueOnce({
        functionCalls: [{ id: 'c1', name: 'get_vulnerability_by_cve', args: { cve_id: 'CVE-2021-44228' } }],
        text: '',
      })
      .mockResolvedValueOnce({ functionCalls: [], text: 'Log4Shell is critical.' });

    const client = makeMockClient();
    client.callTool.mockResolvedValue({ found: true, title: 'Log4Shell' });

    const result = await ask('What is Log4Shell?', client as any);

    expect(result).toBe('Log4Shell is critical.');
    expect(client.callTool).toHaveBeenCalledWith('get_vulnerability_by_cve', {
      cve_id: 'CVE-2021-44228',
    });
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    // Second sendMessage should carry the functionResponse parts under `message`
    const secondCallArg = (mockSendMessage.mock.calls[1] as any[])[0];
    expect(secondCallArg.message[0]).toMatchObject({
      functionResponse: { name: 'get_vulnerability_by_cve' },
    });
  });

  it('max 10 iterations reached → appends iteration-limit note', async () => {
    // Every response keeps returning a function call → loop never breaks naturally
    mockSendMessage.mockResolvedValue({
      functionCalls: [{ id: 'c1', name: 'list_vendors', args: {} }],
      text: 'partial',
    });

    const client = makeMockClient();
    client.callTool.mockResolvedValue([]);

    const result = await ask('Keep going forever', client as any);

    expect(result).toContain('[Note: Query required too many steps');
    // 1 initial sendMessage + 10 iterations = 11 total
    expect(mockSendMessage).toHaveBeenCalledTimes(11);
  });

  it('listTools() failure propagates as rejection before Gemini chat is created', async () => {
    const client = {
      listTools: jest.fn<() => Promise<any>>().mockRejectedValue(new Error('MCP server offline')),
      callTool: jest.fn(),
    };

    await expect(ask('Any question', client as any)).rejects.toThrow('MCP server offline');
    expect(mockChatsCreate).not.toHaveBeenCalled();
  });

  it('passes abortSignal through to each sendMessage call', async () => {
    mockSendMessage.mockResolvedValue({ functionCalls: [], text: 'done' });

    const controller = new AbortController();
    const client = makeMockClient();
    await ask('test', client as any, controller.signal);

    const callArg = (mockSendMessage.mock.calls[0] as any[])[0];
    expect(callArg.config?.abortSignal).toBe(controller.signal);
  });
});
