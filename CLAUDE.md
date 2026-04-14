# CLAUDE.md — Vulnerability Registry MCP Server

> This file is the source of truth for all Claude Code sessions on this project.
> Always read it at the start of every session before touching any code.

---

## 1. Project Mission

Build a production-quality **MCP (Model Context Protocol) Server** in TypeScript that wraps a legacy, pipe-delimited vulnerability registry and exposes it as structured tools for any MCP-compatible LLM client (Claude Desktop, Ollama, Groq, etc.).

This is a take-home assignment for **Deloitte**. The output must be interview-ready: clean, reasoned, and demonstrable. The interviewer will ask _why_ decisions were made, not just _what_ was built.

Full requirements are in [`english_instruction.md`](./english_instruction.md). Read it. Every sentence matters.

---

## 2. Dual Mindset — Always Active

Every implementation decision must pass through **both** lenses simultaneously:

### As a Senior Software Engineer

- Write clean, idiomatic TypeScript with explicit types — no `any`.
- Design for scale: the database is expected to grow to thousands of records. In-memory indexing matters.
- Parse the metadata block dynamically — do not hardcode column names. The `VERSION` field is a hint that the format will evolve.
- Follow the existing project conventions: ESM modules, `dist/` output, Prettier formatting, Jest for tests.
- Errors should be informative and safe — never leak raw stack traces to the MCP client.

### As a Security Researcher

- You are building a tool that security analysts use daily. The data is CVEs, CVSS scores, affected versions — treat it with domain respect.
- When designing tools, think about what a real analyst asks:
  - "Which critical CVEs are still open right now?"
  - "What does the Linux Kernel's vulnerability history look like?"
  - "How many unpatched highs from 2023 should I care about?"
- **Input validation is not optional.** Every tool parameter that accepts user-supplied strings (CVE IDs, vendor names, severity levels, date ranges) must be validated and sanitized before touching the in-memory store. Injection into structured queries must be considered even when the backend is not SQL.
- **Output sanitization is critical.** Free-text fields in the database (CVE titles, vendor names, version ranges) are returned to LLM clients (Claude, Ollama, Groq). An attacker who can control `.db` files can inject prompt instructions into these fields, influencing LLM behavior. All free-text fields must be sanitized before returning to clients (see `sanitization.ts`).
- Think about **data integrity**: if the `.db` files are malformed or tampered with, the server must fail loudly on startup — not silently serve corrupted data.
- Think about **information exposure**: the MCP tools should return structured, minimal responses — not raw file contents or full internal state.
- Think about **tool design as an attack surface**: overly broad tools (e.g., "return everything") are both bad UX and bad security posture.

---

## 3. Data Format — Know It Cold

Both files use a custom pipe-delimited format with a metadata preamble:

```
# METADATA
# FORMAT: type|field1|field2|...
# VERSION: 1.0
TYPE|value1|value2|...
```

### vendors.db columns

`type | id | name | category | hq | founded`

### vulnerabilities.db columns

`type | id | cve_id | title | vendor_id | severity | cvss_score | affected_versions | status | published`

Key domain rules:

- `vendor_id` in vulnerabilities references `id` in vendors — treat this as a foreign key.
- `status` is always `open` or `patched` — validate against this enum.
- `severity` values seen: `critical`, `high`, `medium`, `low` — treat as an ordered enum for filtering.
- `cvss_score` is a float 0.0–10.0.
- `published` is ISO date `YYYY-MM-DD`.
- `affected_versions` is free text — do not attempt to parse it into a semver range.

---

## 4. Architecture Constraints

- **Entry point**: `src/index.ts` — wires stdio transport. Do not change its structure.
- **Server factory**: `src/server.ts` — all tools are registered here via `createServer()`.
- **Transport**: stdio only. The server is launched by an MCP client, not run standalone.
- **In-memory store**: parse and index both files at startup inside `createServer()` (or a helper it calls). No file I/O during tool calls.
- **No external database**: the files are the only data source.
- **ESM**: the project is `"type": "module"`. All imports must use `.js` extensions (TypeScript ESM convention).
- **Zod** is available for schema validation — use it for tool input schemas.
- **No new dependencies** unless clearly justified. The MCP SDK and Zod cover everything needed.

---

## 5. Tool Design Philosophy

Design tools the way you would design a security analyst's query interface — not a CRUD API.

Good tools are:

- **Purposeful**: each tool answers a real analyst question.
- **Composable**: an LLM should be able to call 2–3 tools to answer complex questions.
- **Typed**: inputs and outputs have explicit schemas (use Zod for inputs).
- **Filtered**: tools accept filter parameters (severity, status, date range, vendor) rather than returning everything and leaving filtering to the LLM.

Bad tools are:

- "Get all vulnerabilities" with no parameters.
- Tools that return raw internal data structures.
- Tools with string parameters that accept arbitrary SQL-like syntax.

Aim for **5–8 well-designed tools** rather than 2 generic ones or 15 redundant ones.

---

## 5.3 Rate Limiting & DoS Protection

All tool calls are rate-limited to prevent DoS attacks and resource exhaustion.

**Configuration:**

- **Rate:** 100 calls per second (global, per server instance)
- **Concurrency:** Maximum 50 concurrent calls (prevents thundering herd)
- **Implementation:** Token bucket using `bottleneck` library
- **Behavior:** Excess calls are automatically queued; no explicit rejection (graceful degradation)

**Protection against:**

- LLM clients looping to enumerate the entire database (1000+ calls)
- Resource exhaustion (CPU, memory) from concurrent filters on large datasets
- Context flooding attacks (repeated large requests)

**Implementation:** See `src/rateLimiter.ts` and `src/tools/helpers.ts` (`safeHandlerWithRateLimit`).

**Scaling note:** This implementation is per-server-instance. If running multiple MCP server instances, use a distributed rate limiter (e.g., Redis) or API gateway-level rate limiting.

---

## 5.4 Prompt Injection Defense

The server returns free-text fields (CVE titles, vendor names, version ranges) to LLM clients. An attacker who controls `.db` files can embed arbitrary instructions in these fields, attempting to influence the LLM's behavior. This is mitigated by `src/sanitization.ts`:

**Defense strategy:**

1. **Detect suspicious keywords** — Patterns like "ignore previous instructions", "system prompt", "you are now", "execute code" are detected and logged
2. **Normalize and clean Unicode** — Bidirectional overrides, zero-width characters, and control characters are removed to prevent hidden instructions
3. **Redact suspicious content** — If a field contains injection attempts, it's replaced with `[REDACTED: Suspicious content detected]` before returning to the LLM
4. **Audit logging** — Suspicious content is logged for forensic analysis

**Applied to:**

- `vulnerability.title` (CVE titles)
- `vulnerability.affected_versions` (version ranges)
- `vendor.name` (vendor names)
- `vendor.category` (vendor categories)
- `vendor.hq` (headquarters)

**Not applied to:**

- Structured fields (severity, status, CVSS) — these are enums/numbers, not free text
- IDs (cve_id, vendor_id) — validated via regex
- Dates (published) — validated via ISO 8601 format

**Testing:** See `tests/sanitization.test.ts` for 59 test cases covering real-world injection scenarios (system prompt exposure, jailbreaks, Unicode tricks, etc.).

---

## 5.5 Pagination & Scaling Strategy

The database is expected to grow to thousands of records (target: up to 10k records). Tools that return lists must support offset-based pagination:

**Pagination design:**

- Every list-returning tool accepts `offset` (default 0) and `limit` (default 25, max 100)
- Response includes: `{ total_matched, returned, offset, limit, results }`
- Analysts can fetch any page (e.g., record #1001 with offset=1001, limit=1)
- DoS protection comes from capping `limit` at 100 records per call, not from capping total accessible range

**Scaling to 10k+ records:**

- Current approach (in-memory maps + O(n) filter scans) handles up to 10k records efficiently
- Max 100 records per call means enumerating 10k records requires ~100 API calls — acceptable cost
- Beyond 10k, add secondary indexes on hot dimensions (severity, status, year)
- If 100k+ records needed, consider streaming the parser and embedding SQLite for ad-hoc queries

**Why this matters:**

- Analysts need to find "all Microsoft CVEs" even if there are 200 of them
- Full enumeration via pagination is allowed; bounded by per-call limits, not total access
- Offset + limit is simple, composable, and doesn't require cursor state

---

## 6. Testing

- Tests live in `tests/`. The existing `server.test.ts` is a scaffold — expand it.
- Cover: parser correctness, tool input validation (valid and invalid inputs), cross-referencing logic (vendor join).
- Do not mock the file system for parser tests — use small inline fixture strings instead.
- Run with `npm test`.

---

## 7. README Requirements (from the assignment)

The README must include:

1. Setup and run instructions.
2. Description of each implemented tool.
3. Design decisions and why.
4. What would be built differently or added with more time.

Write the README as if explaining it to a Deloitte security engineering interviewer. Mention the security considerations explicitly — they will ask.

**Submission format**: GitHub repo first, then a live discussion. The README is the first thing the interviewer reads. The code is what they open during the call. Every design decision in the code must be explainable out loud in one sentence.

---

## 8. What the Interviewer Will Probe

Expect questions on:

- Why these tools and not others?
- How does the parser handle future format versions (VERSION bump)?
- What happens if a vulnerability references a vendor_id that doesn't exist?
- What input validation exists and why?
- How would this scale to 100,000 records?
- What would you add if this went to production? (auth, rate limiting, audit logging)

Have answers. Build answers into the code where possible, and document the rest in the README.

---

## 9. Workflow Rules for Claude

- Always read existing files before modifying them.
- Do not add features beyond what the assignment asks for.
- Do not add comments to code you did not touch.
- Do not introduce external dependencies without asking.
- When making a non-obvious design decision, leave a one-line comment explaining _why_.
- Format code with Prettier (`npm run format`) before considering a task done.
- After implementing tools, verify the server builds cleanly with `npm run build`.
