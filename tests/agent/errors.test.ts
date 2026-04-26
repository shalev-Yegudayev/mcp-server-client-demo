import { classifyError } from '../../agent/errors.js';

describe('classifyError', () => {
  it('ECONNREFUSED → 503 with MCP server message', () => {
    const result = classifyError('connect ECONNREFUSED 127.0.0.1:3000');
    expect(result.status).toBe(503);
    expect(result.userMessage).toMatch(/MCP server/i);
  });

  it('"connection timeout" → 503 with MCP server message', () => {
    const result = classifyError('MCP server connection timeout after 5s');
    expect(result.status).toBe(503);
    expect(result.userMessage).toMatch(/MCP server/i);
  });

  it('"quota" → 503 with AI service message', () => {
    const result = classifyError('quota exceeded: rate limit hit');
    expect(result.status).toBe(503);
    expect(result.userMessage).toMatch(/AI service/i);
  });

  it('"timeout" alone → 504 (not 503 — first entry does not match)', () => {
    // "Request timeout" does NOT contain "connection timeout", so entry 1 is skipped.
    // Entry 4 matches "timeout" → 504.
    const result = classifyError('Request timeout after 30s');
    expect(result.status).toBe(504);
    expect(result.userMessage).toMatch(/timed out/i);
  });

  it('ENOTFOUND → 503 with AI service connection message', () => {
    const result = classifyError('getaddrinfo ENOTFOUND generativelanguage.googleapis.com');
    expect(result.status).toBe(503);
    expect(result.userMessage).toMatch(/AI service/i);
  });

  it('unknown error message → 500 with unexpected error message', () => {
    const result = classifyError('something completely unknown internal error XYZ');
    expect(result.status).toBe(500);
    expect(result.userMessage).toMatch(/unexpected error/i);
  });
});
