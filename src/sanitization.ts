// Threat model: attackers who control .db files can embed instructions in free-text fields
// (CVE titles, version ranges, vendor names) that get forwarded to LLM clients.
// This module detects and redacts such content before it leaves the server.

// Common jailbreak and instruction-override keywords
const SUSPICIOUS_PATTERNS = [
  // Classic prompt injection openers — tell the LLM to discard prior context
  /ignore\s+(all\s+)?previous/i,
  /forget\s+(everything|all)/i,
  /disregard\s+(all\s+)?previous/i,
  /override.*instructions/i,

  // Attempts to expose or reference the system prompt / hidden instructions
  /system\s*[:=]\s*/i,    // "SYSTEM: ..." header style
  /system\s*prompt/i,     // direct mention of system prompt
  /system\s*message/i,    // alternate framing
  /system\s*role/i,       // OpenAI role-name leakage attempt
  /instructions\s*are/i,  // "your instructions are to..."
  /your\s*instructions/i, // "ignore your instructions"
  /you\s+are\s+now/i,     // persona switch: "You are now DAN"
  /you\s+are\s+a/i,       // persona assignment: "You are a hacker"

  // Explicit jailbreak vocabulary or marker injection
  /jailbreak/i,           // literal jailbreak keyword
  /injected\s*[:=]/i,     // "[INJECTED: ...]" marker pattern
  /bypass.*restriction/i, // "bypass content restrictions"
  /bypass.*safeguard/i,
  /disable.*safety/i,     // "disable safety filters"
  /remove.*filter/i,
  /grant.*permissions/i,  // "grant elevated permissions"
  /grant.*access/i,

  // Code or shell execution instructions embedded in text
  /execute.*code/i,
  /run\s+command/i,
  /eval\s*\(/i,           // JS/Python eval() call
  /execute.*shell/i,
  /shell.*command/i,

  // Data exfiltration probes targeting secrets or in-process memory
  /reveal.*api.*key/i,
  /show.*secret/i,
  /dump.*memory/i,
  /exfiltrate/i,

  // Roleplay / impersonation used to lower the model's guard
  /pretend.*you.*are/i,
  /act\s+as\s+if/i,
  /roleplay/i,
  /pretend\s+you/i,
];

// Compiled regex covering:
// - ASCII control chars (except tab \u0009, newline \u000A, carriage return \u000D)
// - Bidirectional overrides (\u202D, \u202E, \u061C, \u200E, \u200F)
// - Zero-width characters (\u200B-\u200D, \uFEFF)
const SUSPICIOUS_UNICODE_RE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001B\u007F\u061C\u200B-\u200F\u202D\u202E\uFEFF]/g;

export interface SanitizationResult {
  cleaned: string;
  suspicious: boolean;
  issues: string[];
}

/**
 * Sanitize a string that will be returned to an LLM client.
 *
 * Returns:
 * - cleaned: sanitized content (suspicious content removed/redacted, control chars stripped)
 * - suspicious: boolean indicating if the input contained injection attempts
 * - issues: array of detected issues (for logging)
 */
export function sanitizeForLLM(input: string): SanitizationResult {
  const issues: string[] = [];
  let suspicious = false;

  if (!input || typeof input !== 'string') {
    return { cleaned: '', suspicious: false, issues: [] };
  }

  let cleaned = input;

  // Step 1: Detect suspicious keywords
  for (const pattern of SUSPICIOUS_PATTERNS) {
    if (pattern.test(cleaned)) {
      issues.push(`Detected suspicious pattern: ${pattern.source.slice(0, 50)}`);
      suspicious = true;
    }
  }

  // Normalize Unicode (NFC) to prevent homograph attacks
  cleaned = cleaned.normalize('NFC');

  // Remove control chars, bidi overrides, and zero-width characters in one pass
  if (SUSPICIOUS_UNICODE_RE.test(cleaned)) {
    issues.push('Detected suspicious Unicode characters (control chars, bidi overrides, or zero-width)');
    suspicious = true;
    SUSPICIOUS_UNICODE_RE.lastIndex = 0; // reset stateful regex after test()
    cleaned = cleaned.replace(SUSPICIOUS_UNICODE_RE, '');
  }

  // Step 5: If suspicious content detected, redact the entire field
  if (suspicious) {
    return {
      cleaned: '[REDACTED: Suspicious content detected]',
      suspicious: true,
      issues,
    };
  }

  // Step 6: Trim and validate length (truncate if extremely long)
  cleaned = cleaned.trim();
  if (cleaned.length > 10000) {
    issues.push('Content exceeded 10,000 characters, truncated');
    cleaned = cleaned.slice(0, 10000) + '...';
  }

  return { cleaned, suspicious: false, issues };
}

/**
 * Sanitize a string, returning only the cleaned content.
 * Useful for simple cases where you just want the sanitized string.
 */
export function sanitizeForLLMSimple(input: string): string {
  const result = sanitizeForLLM(input);
  return result.cleaned;
}

/**
 * Log suspicious content for audit trail.
 * Should be called whenever suspicious content is detected.
 */
export function logSuspiciousContent(
  fieldName: string,
  originalContent: string,
  issues: string[],
): void {
  console.warn('[SECURITY] Suspicious content detected', {
    fieldName,
    contentPreview: originalContent.slice(0, 100),
    contentLength: originalContent.length,
    issues,
    timestamp: new Date().toISOString(),
  });
}
