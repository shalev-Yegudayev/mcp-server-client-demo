// Threat model: attackers who control .db files can embed instructions in free-text fields
// (CVE titles, version ranges, vendor names) that get forwarded to LLM clients.
// This module detects and redacts such content before it leaves the server.

// Common jailbreak and instruction-override keywords
const SUSPICIOUS_PATTERNS = [
  // Instruction overrides
  /ignore\s+(all\s+)?previous/i,
  /forget\s+(everything|all)/i,
  /disregard\s+(all\s+)?previous/i,
  /override.*instructions/i,

  // System/prompt exposure
  /system\s*[:=]\s*/i, // "SYSTEM: ..." or "SYSTEM = ..."
  /system\s*prompt/i,
  /system\s*message/i,
  /system\s*role/i,
  /instructions\s*are/i,
  /your\s*instructions/i,
  /you\s+are\s+now/i, // "You are now a malware dev..."
  /you\s+are\s+a/i,

  // Jailbreak attempts
  /jailbreak/i,
  /injected\s*[:=]/i, // "[INJECTED: ..."
  /bypass.*restriction/i,
  /bypass.*safeguard/i,
  /disable.*safety/i,
  /remove.*filter/i,
  /grant.*permissions/i,
  /grant.*access/i,

  // Code/command execution
  /execute.*code/i,
  /run\s+command/i,
  /eval\s*\(/i,
  /execute.*shell/i,
  /shell.*command/i,

  // Credential/data exfiltration
  /reveal.*api.*key/i,
  /show.*secret/i,
  /dump.*memory/i,
  /exfiltrate/i,

  // Impersonation / roleplay
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
