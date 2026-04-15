export const REQUEST_TIMEOUT_MS = 30000;

// Races a promise against AbortSignal.timeout — the Node.js equivalent of a CancellationToken.
// The underlying ask() call cannot be cancelled (Google AI SDK doesn't expose signal), but
// the HTTP response is sent exactly once via normal throw/catch rather than headersSent guards.
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const signal = AbortSignal.timeout(ms);
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  ]);
}

export function validateQuestion(question: string): { valid: boolean; error?: string } {
  const byteSize = Buffer.byteLength(question, 'utf8');
  if (byteSize > 8000) {
    return { valid: false, error: 'Question is too large. Please simplify.' };
  }

  // If normalized form is significantly shorter, original had excessive combining chars.
  const normalized = question.normalize('NFC');
  if (question.length > normalized.length * 2) {
    return { valid: false, error: 'Question contains suspicious Unicode sequences.' };
  }

  if (!/^[\p{L}\p{N}\p{P}\p{Z}\n\r\t]+$/gu.test(question)) {
    return { valid: false, error: 'Question contains invalid characters.' };
  }

  return { valid: true };
}
