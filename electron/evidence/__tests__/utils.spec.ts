/**
 * Unit tests for Evidence Scoring utility modules
 */

import { describe, it, expect } from 'vitest';
import { extractNgrams, normalizeForNgram } from '../utils/ngram';
import { computeMinHash, estimateJaccard } from '../utils/minhash';
import { extractDirectives, checkCompliance } from '../utils/directives';

// --- N-gram ---
describe('ngram', () => {
  it('normalizes text', () => {
    expect(normalizeForNgram('  Hello  World  ')).toBe('hello world');
  });

  it('extracts character trigrams', () => {
    const ngrams = extractNgrams('hello', 3);
    expect(ngrams.has('hel')).toBe(true);
    expect(ngrams.has('ell')).toBe(true);
    expect(ngrams.has('llo')).toBe(true);
    expect(ngrams.size).toBe(3);
  });

  it('handles short text', () => {
    const ngrams = extractNgrams('ab', 3);
    expect(ngrams.size).toBe(1); // 'ab' (shorter than n)
    expect(ngrams.has('ab')).toBe(true);
  });

  it('handles empty text', () => {
    const ngrams = extractNgrams('', 3);
    expect(ngrams.size).toBe(0);
  });
});

// --- MinHash ---
describe('minhash', () => {
  it('identical sets have Jaccard ≈ 1.0', () => {
    const ngrams = extractNgrams('the quick brown fox jumps over the lazy dog', 3);
    const sigA = computeMinHash(ngrams, 128);
    const sigB = computeMinHash(ngrams, 128);
    expect(estimateJaccard(sigA, sigB)).toBeCloseTo(1.0, 1);
  });

  it('disjoint sets have low Jaccard', () => {
    const ngramsA = extractNgrams('aaaaaaaaa', 3);
    const ngramsB = extractNgrams('zzzzzzzzz', 3);
    const sigA = computeMinHash(ngramsA, 128);
    const sigB = computeMinHash(ngramsB, 128);
    expect(estimateJaccard(sigA, sigB)).toBeLessThan(0.2);
  });

  it('similar texts have moderate Jaccard', () => {
    const ngramsA = extractNgrams('the quick brown fox', 3);
    const ngramsB = extractNgrams('the quick brown cat', 3);
    const sigA = computeMinHash(ngramsA, 256);
    const sigB = computeMinHash(ngramsB, 256);
    const j = estimateJaccard(sigA, sigB);
    expect(j).toBeGreaterThan(0.2);
    expect(j).toBeLessThan(0.9);
  });

  it('throws on mismatched signature lengths', () => {
    const sig128 = computeMinHash(extractNgrams('test', 3), 128);
    const sig64 = computeMinHash(extractNgrams('test', 3), 64);
    expect(() => estimateJaccard(sig128, sig64)).toThrow('Signature length mismatch');
  });
});

// --- Directives ---
describe('directives', () => {
  it('extracts must directives', () => {
    const directives = extractDirectives(
      'You must always respond in Korean.\nYou should use clear language.',
    );
    expect(directives.length).toBeGreaterThanOrEqual(2);
    expect(directives.some((d) => d.type === 'must')).toBe(true);
  });

  it('extracts must_not directives', () => {
    const directives = extractDirectives(
      'Never skip this checklist.\nDo not use inline styles.\nAvoid hardcoded values.',
    );
    const mustNots = directives.filter((d) => d.type === 'must_not');
    expect(mustNots.length).toBeGreaterThanOrEqual(2);
  });

  it('returns empty for text without directives', () => {
    const directives = extractDirectives('This is just a plain description of the project.');
    expect(directives.length).toBe(0);
  });

  it('checks compliance correctly', () => {
    const directives = extractDirectives(
      'You must always respond in Korean.\nNever skip the checklist.',
    );
    const { total, complied, rate } = checkCompliance(
      directives,
      'responding in korean as instructed, the checklist was not skipped',
    );
    expect(total).toBeGreaterThan(0);
    expect(complied).toBeGreaterThan(0);
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThanOrEqual(1);
  });

  it('returns rate 0 for empty directives', () => {
    const result = checkCompliance([], 'some response');
    expect(result.rate).toBe(0);
  });
});
