import { describe, expect, it } from 'vitest';
import {
  memoryCardLabel,
  supportsMemoryCard,
  supportsMultiProjectMemory,
} from '../memoryCard';

describe('supportsMemoryCard', () => {
  it('accepts claude and codex', () => {
    expect(supportsMemoryCard('claude')).toBe(true);
    expect(supportsMemoryCard('codex')).toBe(true);
  });

  it('rejects gemini and unknown values', () => {
    expect(supportsMemoryCard('gemini')).toBe(false);
    expect(supportsMemoryCard('')).toBe(false);
    expect(supportsMemoryCard(undefined)).toBe(false);
    expect(supportsMemoryCard('other')).toBe(false);
  });
});

describe('memoryCardLabel', () => {
  it('returns provider-specific display label', () => {
    expect(memoryCardLabel('claude')).toBe('Claude Memory');
    expect(memoryCardLabel('codex')).toBe('Codex Memory');
  });
});

describe('supportsMultiProjectMemory', () => {
  it('is enabled only for claude (codex memory is global, not per-project)', () => {
    expect(supportsMultiProjectMemory('claude')).toBe(true);
    expect(supportsMultiProjectMemory('codex')).toBe(false);
  });
});
