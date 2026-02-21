/**
 * N-gram tokenizer for text similarity comparison.
 *
 * Used by MinHash (Signal 2: Text Overlap).
 * Produces character-level n-grams from normalized text.
 */

/**
 * Normalize text for n-gram extraction: lowercase, collapse whitespace.
 */
export const normalizeForNgram = (text: string): string =>
  text.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Extract character-level n-grams as a Set of strings.
 *
 * @param text - Input text (will be normalized)
 * @param n - N-gram size (default 3)
 * @returns Set of unique n-gram strings
 */
export const extractNgrams = (text: string, n = 3): Set<string> => {
  const normalized = normalizeForNgram(text);
  const ngrams = new Set<string>();

  if (normalized.length < n) {
    if (normalized.length > 0) ngrams.add(normalized);
    return ngrams;
  }

  for (let i = 0; i <= normalized.length - n; i++) {
    ngrams.add(normalized.slice(i, i + n));
  }

  return ngrams;
};
