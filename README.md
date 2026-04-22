# Vulnerability Registry MCP Server

An MCP server wrapping a legacy pipe-delimited vulnerability registry (`vendors.db`, `vulnerabilities.db`) and exposing it as tools for any MCP-compatible client.

## Requirements

- Node.js >= 18
- npm

## Setup

```bash
npm install
npm run build
npm start
```

## Scripts

| Script                | Purpose                       |
| --------------------- | ----------------------------- |
| `npm run build`       | Compile TypeScript to `dist/` |
| `npm start`           | Run the MCP server (stdio)    |
| `npm run dev`         | TypeScript watch build        |
| `npm run agent`       | Run the Gemini agent server   |
| `npm test`            | Jest                          |
| `npm run format`      | Prettier                      |
| `npm run lint`        | ESLint                        |
| `npm run mcp:inspect` | Launch MCP Inspector          |

## Project Layout

```
src/
  index.ts         entry; wires stdio transport
  server.ts        server factory + data loading
  parser.ts        generic pipe-delimited parser (no hardcoded columns)
  store.ts         Zod-validated in-memory store with indexes
  rateLimiter.ts   token bucket (100/s, 50 concurrent)
  sanitization.ts  prompt-injection defense for free-text fields
  tools/           one file per tool
agent/             Phase 2: Express + Gemini agent
  server.ts        Express app, /ask endpoint
  gemini.ts        Gemini client + agentic loop
  mcpClient.ts     spawns and talks to the MCP server
  systemPrompt.ts  analyst-facing system prompt
  validation.ts    request validation + timeout helpers
  rateLimiter.ts   per-IP request limiter
  ui/              static browser UI
tests/
vendors.db  vulnerabilities.db
```

## Tools

All inputs are Zod-validated. List tools support `offset` + `limit` (default 25, max 100).

### `get_vulnerability_by_cve`

Exact CVE lookup. Returns full details with vendor, or `{ found: false }`.

### `search_vulnerabilities`

Filter by any combination of `severity`, `status`, `vendor_id`, `min_cvss`, `max_cvss`, `published_from`, `published_to`. Returns `{ total_matched, returned, offset, limit, results }`.

### `list_vendors`

List vendors with optional `category` and `name_contains` (substring) filters.

### `get_vendor_vulnerabilities`

All vulnerabilities for a `vendor_id`, optionally filtered by `status` and `severity`. O(1) via per-vendor index.

### `vulnerability_stats`

Aggregate counts grouped by `severity`, `status`, `vendor`, or `year`.

### `top_critical_open`

Highest-CVSS open vulnerabilities sorted descending. Default limit 10, max 50.

## Design Decisions

**Dynamic parser.** Column names come from the `# FORMAT:` header at startup, nothing is hardcoded. A schema change or `VERSION` bump flows through without touching the parser.

**Load once, index at startup.** No file I/O on the tool call path. Four indexes built at load time: `vendorsById`, `vulnsByCveId` (case-insensitive), `vulnsByVendorId`, `openVulnsByScore`.

**Zod at every boundary.** Rows are validated on load, tool inputs are validated before they touch the store. Bad data fails loudly at startup with the offending row number.

**Orphan handling.** Vulnerabilities referencing an unknown `vendor_id` are dropped with a stderr count rather than crashing the server. A missing vendor is recoverable noise; a malformed row is not.

**Narrow tool surface.** Six tools modeled after real analyst questions, no generic "get everything" endpoint. Internal store structures are never serialized out.

## Security

- All free-text fields (CVE titles, vendor names, version ranges) are sanitized before being returned to LLM clients. Suspicious keywords and dangerous Unicode are detected and redacted to prevent prompt injection.
- Tool inputs are regex/enum-validated before hitting any index, no arbitrary query syntax is accepted.
- Errors are caught at the handler level; raw stack traces never reach the MCP client.
- All tool calls are rate-limited (100/s, max 50 concurrent) via `bottleneck`.

## Phase 2: Gemini Agent

An Express server + Gemini agent that takes natural language questions, calls the MCP tools, and returns a synthesized answer. Multi-step queries work via an agentic loop (max 10 iterations).

### Setup

1. Get a free key from [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Copy `.env.example` to `.env` and set `GEMINI_API_KEY` (and optionally `GEMINI_MODEL`)
3. `npm run build && npm run agent`
4. Open http://localhost:3000

### How it works

The agent discovers all 6 tools dynamically via `mcpClient.listTools()` on each request, sends the question to Gemini with tool declarations, executes any function calls via the MCP client, and feeds results back until Gemini returns a text answer.

### Limitations

- Stateless, no chat history between requests
- No streaming, full answer returned at once
- Single user, no auth or session management

## What I'd Add With More Time

### Engineering & Infrastructure

- **Audit logging** of every tool call with arguments, timestamps, and caller identity for incident response.
- **Data integrity checks** at startup (checksums, size bounds) to detect tampered `.db` files.
- **Distributed rate limiting** via Redis for multi-instance deployments.
- **Auth / identity** if the transport moves beyond stdio, a networked transport would need API keys or JWT to identify callers.
- **Streamable HTTP transport with streaming responses** to allow remote clients to connect without spawning a subprocess and stream Gemini answers to the browser for long queries.
- **Remote data sources** — replace local `.db` file reads with a remote database (PostgreSQL, S3-hosted files, or a streaming CDC feed) so the MCP server can serve live, centrally-managed vulnerability data without redeployment.
- **Security monitoring** for suspicious patterns: burst queries, repeated errors, unusual filter combinations.

### Analyst-Facing Capabilities

- **Severity trend alerts**, push notifications (webhook, Slack, email) when open critical counts cross a threshold.
- **Vendor risk scoring**, a single aggregate score per vendor from CVSS, open count, and severity mix.
- **Blast radius estimation**, cross-reference affected versions against an asset inventory to show how many internal systems are exposed.
