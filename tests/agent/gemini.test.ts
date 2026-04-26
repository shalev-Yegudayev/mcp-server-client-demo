import { jest } from '@jest/globals';

// ── ESM mock setup ────────────────────────────────────────────────────────────
// Must be called before any import that transitively loads @google/generative-ai.
// jest.unstable_mockModule intercepts the module when gemini.ts is dynamically imported below.

const mockSendMessage = jest.fn<() => Promise<any>>();
const mockStartChat = jest.fn<() => any>(() => ({ sendMessage: mockSendMessage }));
const mockGetGenerativeModel = jest.fn<() => any>(() => ({ startChat: mockStartChat }));

jest.unstable_mockModule('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}));

// Dynamic import AFTER mock registration — gemini.ts now loads with the mocked SDK.
const { ask, toGeminiSchema, truncateIfNeeded } = await import('../../agent/gemini.js');

// ── toGeminiSchema ────────────────────────────────────────────────────────────

describe('toGeminiSchema', () => {
  it('strips fields not in the allowed set', () => {
    const input = {
      type: 'object',
      $schema: 'http://json-schema.org/draft-07/schema',
      additionalProperties: false,
      description: 'A CVE search',
      properties: {},
    };
    const result = toGeminiSchema(input);
    expect(result).not.toHaveProperty('$schema');
    expect(result).not.toHaveProperty('additionalProperties');
    expect(result.type).toBe('object');
    expect(result.description).toBe('A CVE search');
  });

  it('keeps all allowed fields: type, description, properties, required, items, enum, format, nullable', () => {
    const input: Record<string, unknown> = {
      type: 'string',
      description: 'test',
      required: ['id'],
      items: { type: 'string' },
      enum: ['open', 'patched'],
      format: 'date',
      nullable: true,
    };
    const result = toGeminiSchema(input);
    expect(result).toEqual(input);
  });

  it('recursively cleans nested properties', () => {
    const input = {
      type: 'object',
      properties: {
        cve_id: {
          type: 'string',
          description: 'CVE identifier',
          $comment: 'should be stripped',
          pattern: 'CVE-.*', // not in allowed set
        },
      },
    };
    const result = toGeminiSchema(input);
    const cveProp = (result.properties as any).cve_id;
    expect(cveProp).not.toHaveProperty('$comment');
    expect(cveProp).not.toHaveProperty('pattern');
    expect(cveProp.type).toBe('string');
    expect(cveProp.description).toBe('CVE identifier');
  });

  it('recursively cleans items schema', () => {
    const input = {
      type: 'array',
      items: {
        type: 'string',
        minLength: 1, // not in allowed set → stripped
        description: 'a CVE id',
      },
    };
    const result = toGeminiSchema(input);
    const items = result.items as Record<string, unknown>;
    expect(items).not.toHaveProperty('minLength');
    expect(items.description).toBe('a CVE id');
  });
});

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
    mockStartChat.mockClear();
    mockGetGenerativeModel.mockClear();
  });

  function makeMockClient(tools: unknown[] = []) {
    return {
      listTools: jest.fn<() => Promise<any>>().mockResolvedValue(tools),
      callTool: jest.fn<() => Promise<any>>().mockResolvedValue({ found: true }),
    };
  }

  it('no tool calls → returns response text directly', async () => {
    const mockResponse = {
      functionCalls: jest.fn().mockReturnValue([]),
      text: jest.fn().mockReturnValue('Here is the answer'),
    };
    mockSendMessage.mockResolvedValue({ response: mockResponse });

    const client = makeMockClient();
    const result = await ask('What is CVE-2021-44228?', client as any);

    expect(result).toBe('Here is the answer');
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it('one round of tool calls → tool result sent back → returns final text', async () => {
    // First response: has a function call
    const firstResponse = {
      functionCalls: jest
        .fn()
        .mockReturnValueOnce([
          { name: 'get_vulnerability_by_cve', args: { cve_id: 'CVE-2021-44228' } },
        ])
        .mockReturnValue([]),
      text: jest.fn().mockReturnValue(''),
    };
    // Second response: no function calls, has final text
    const finalResponse = {
      functionCalls: jest.fn().mockReturnValue([]),
      text: jest.fn().mockReturnValue('Log4Shell is critical.'),
    };
    mockSendMessage
      .mockResolvedValueOnce({ response: firstResponse })
      .mockResolvedValueOnce({ response: finalResponse });

    const client = makeMockClient();
    client.callTool.mockResolvedValue({ found: true, title: 'Log4Shell' });

    const result = await ask('What is Log4Shell?', client as any);

    expect(result).toBe('Log4Shell is critical.');
    expect(client.callTool).toHaveBeenCalledWith('get_vulnerability_by_cve', {
      cve_id: 'CVE-2021-44228',
    });
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
    // Second sendMessage arg should contain the functionResponse
    const secondArg = (mockSendMessage.mock.calls[1] as any[])[0];
    expect(secondArg[0]).toMatchObject({
      functionResponse: { name: 'get_vulnerability_by_cve' },
    });
  });

  it('max 10 iterations reached → appends iteration-limit note', async () => {
    // Every response keeps returning a function call → loop never breaks naturally
    const loopingResponse = {
      functionCalls: jest
        .fn()
        .mockReturnValue([{ name: 'list_vendors', args: {} }]),
      text: jest.fn().mockReturnValue('partial'),
    };
    mockSendMessage.mockResolvedValue({ response: loopingResponse });

    const client = makeMockClient();
    client.callTool.mockResolvedValue([]);

    const result = await ask('Keep going forever', client as any);

    expect(result).toContain('[Note: Query required too many steps');
    // 1 initial sendMessage + 10 iterations = 11 total
    expect(mockSendMessage).toHaveBeenCalledTimes(11);
  });

  it('listTools() failure propagates as rejection before Gemini is called', async () => {
    const client = {
      listTools: jest.fn<() => Promise<any>>().mockRejectedValue(new Error('MCP server offline')),
      callTool: jest.fn(),
    };

    await expect(ask('Any question', client as any)).rejects.toThrow('MCP server offline');
    // getGenerativeModel should never be called if listTools fails first
    expect(mockGetGenerativeModel).not.toHaveBeenCalled();
  });
});
