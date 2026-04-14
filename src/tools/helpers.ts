import type { Vendor, Vulnerability } from '../store.js';
import { sanitizeForLLMSimple, sanitizeForLLM, logSuspiciousContent } from '../sanitization.js';
import { withRateLimit } from '../rateLimiter.js';

export function shapeVulnerability(v: Vulnerability, vendor?: Vendor) {
  // Sanitize free-text fields that could be injection vectors
  const titleResult = sanitizeForLLM(v.title);
  const affectedVersionsResult = sanitizeForLLM(v.affected_versions);

  // Log any suspicious content detected
  if (titleResult.suspicious) {
    logSuspiciousContent('vulnerability.title', v.title, titleResult.issues);
  }
  if (affectedVersionsResult.suspicious) {
    logSuspiciousContent(
      'vulnerability.affected_versions',
      v.affected_versions,
      affectedVersionsResult.issues,
    );
  }

  return {
    id: v.id,
    cve_id: v.cve_id,
    title: titleResult.cleaned,
    severity: v.severity,
    cvss_score: v.cvss_score,
    status: v.status,
    published: v.published,
    affected_versions: affectedVersionsResult.cleaned,
    vendor: vendor
      ? {
          id: vendor.id,
          name: sanitizeForLLMSimple(vendor.name),
          category: sanitizeForLLMSimple(vendor.category),
        }
      : null,
  };
}

export function shapeVendor(v: Vendor) {
  // Sanitize vendor metadata
  const nameResult = sanitizeForLLM(v.name);
  const categoryResult = sanitizeForLLM(v.category);
  const hqResult = sanitizeForLLM(v.hq);

  if (nameResult.suspicious) {
    logSuspiciousContent('vendor.name', v.name, nameResult.issues);
  }
  if (categoryResult.suspicious) {
    logSuspiciousContent('vendor.category', v.category, categoryResult.issues);
  }
  if (hqResult.suspicious) {
    logSuspiciousContent('vendor.hq', v.hq, hqResult.issues);
  }

  return {
    id: v.id,
    name: nameResult.cleaned,
    category: categoryResult.cleaned,
    hq: hqResult.cleaned,
    founded: v.founded,
  };
}

export function ok(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
}

export function fail(message: string) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
  };
}

export function safeHandler<T>(fn: (args: T) => unknown) {
  return async (args: T) => {
    try {
      return ok(fn(args));
    } catch (err) {
      // Never leak raw stack traces to the MCP client.
      const msg = err instanceof Error ? err.message : 'unknown error';
      return fail(msg);
    }
  };
}

/**
 * Wrap a handler with both rate limiting and error handling.
 * Rate limiting ensures a misbehaving client can't exhaust server resources.
 */
export function safeHandlerWithRateLimit<T>(fn: (args: T) => unknown) {
  // First apply rate limiting (queues/throttles the call)
  const rateLimited = withRateLimit(fn);

  // Then apply error handling (catches exceptions)
  return async (args: T) => {
    try {
      const result = await rateLimited(args);
      return ok(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      return fail(msg);
    }
  };
}
