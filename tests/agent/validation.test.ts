import { validateQuestion } from '../../agent/validation.js';

describe('validateQuestion', () => {
  it('empty string is invalid (regex requires at least one character)', () => {
    const result = validateQuestion('');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/invalid characters/i);
  });

  it('string exceeding 8000 bytes is invalid', () => {
    const result = validateQuestion('A'.repeat(8001));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/too large/i);
  });

  it('valid plain ASCII question is accepted', () => {
    const result = validateQuestion('What is CVE-2021-44228?');
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('valid question with non-ASCII letters is accepted', () => {
    const result = validateQuestion('Show me all kernel vulnerabilities please');
    expect(result.valid).toBe(true);
  });

  it('decomposed Hangul jamo string triggers suspicious Unicode ratio check', () => {
    // U+AC01 (Korean syllable) decomposes in NFD to 3 jamo: U+1100 + U+1161 + U+11A8.
    // 300 syllables: original.length 300, NFD.length 900, NFC.length 300.
    // validateQuestion sees original=NFD (900 chars), normalized=NFC (300 chars): 900 > 600.
    // All jamo are in \p{L} (Lo) so only the ratio check fires — not the character regex.
    const syllable = String.fromCodePoint(0xAC01); // syllable with 3 jamo when decomposed
    const decomposed = syllable.repeat(300).normalize('NFD');
    expect(decomposed.length).toBe(900); // sanity-check: 3 jamo * 300
    const result = validateQuestion(decomposed);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/suspicious Unicode/i);
  });

  it('question with null byte is rejected as invalid characters', () => {
    // U+0000 is not in \p{L}\p{N}\p{P}\p{Z}\n\r\t
    const result = validateQuestion('hello' + String.fromCharCode(0) + 'world');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/invalid characters/i);
  });

  it('question with BEL control character is rejected as invalid characters', () => {
    // U+0007 (BEL) is not in the allowed character set
    const result = validateQuestion('hello' + String.fromCharCode(7) + 'world');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/invalid characters/i);
  });
});

