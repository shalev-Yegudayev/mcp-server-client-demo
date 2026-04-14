/**
 * Sanitization module for detecting and mitigating prompt injection attacks.
 *
 * Threat model: Attackers can inject arbitrary instructions into free-text fields
 * (CVE titles, version ranges, vendor names) in .db files. These fields are returned
 * to LLM clients (Claude, Ollama, etc.) and could influence LLM behavior if not sanitized.
 *
 * Strategy:
 * 1. Detect suspicious keywords (jailbreaks, instruction overrides, etc.)
 * 2. Remove control characters and problematic Unicode
 * 3. Log suspicious content for audit
 * 4. Return sanitized content (or redacted if suspicious)
 */

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

// Control characters and suspicious Unicode to remove
const SUSPICIOUS_UNICODE = [
  '\u0000', // Null byte
  '\u0001', // Start of heading
  '\u0002', // Start of text
  '\u0003', // End of text
  '\u0004', // End of transmission
  '\u0005', // Enquiry
  '\u0006', // Acknowledge
  '\u0007', // Bell
  '\u0008', // Backspace
  '\u000B', // Vertical tab
  '\u000C', // Form feed
  '\u000E', // Shift out
  '\u000F', // Shift in
  '\u0010', // Data link escape
  '\u0011', // Device control 1 (XON)
  '\u0012', // Device control 2
  '\u0013', // Device control 3 (XOFF)
  '\u0014', // Device control 4
  '\u0015', // Negative acknowledge
  '\u0016', // Synchronous idle
  '\u0017', // End of transmission block
  '\u0018', // Cancel
  '\u0019', // End of medium
  '\u001A', // Substitute
  '\u001B', // Escape
  '\u007F', // Delete

  // Bidirectional text override characters
  '\u202E', // Right-to-left override
  '\u202D', // Left-to-right override
  '\u061C', // Arabic letter mark
  '\u200E', // Left-to-right mark
  '\u200F', // Right-to-left mark

  // Zero-width characters (can hide text)
  '\u200B', // Zero-width space
  '\u200C', // Zero-width non-joiner
  '\u200D', // Zero-width joiner
  '\uFEFF', // Zero-width no-break space
];

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

  // Step 2: Normalize Unicode (NFC form) to prevent homograph attacks
  cleaned = cleaned.normalize('NFC');

  // Step 3: Remove suspicious Unicode characters
  for (const char of SUSPICIOUS_UNICODE) {
    if (cleaned.includes(char)) {
      issues.push(
        `Detected suspicious Unicode character: U+${char.charCodeAt(0).toString(16).toUpperCase()}`,
      );
      suspicious = true;
      cleaned = cleaned.replace(new RegExp(char, 'g'), '');
    }
  }

  // Step 4: Remove all other control characters (ASCII 0-31 except tab, newline, carriage return)
  // We keep tabs and newlines as they're generally safe
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

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
  // This would normally write to an audit log
  // For now, we'll use console.warn which can be captured
  console.warn('[SECURITY] Suspicious content detected', {
    fieldName,
    contentPreview: originalContent.slice(0, 100),
    contentLength: originalContent.length,
    issues,
    timestamp: new Date().toISOString(),
  });

  // TODO: In production, write to append-only audit log:
  // logger.warn({
  //   event: 'suspicious_content_detected',
  //   fieldName,
  //   contentHash: crypto.createHash('sha256').update(originalContent).digest('hex'),
  //   issues,
  //   timestamp: new Date().toISOString(),
  // });
}
