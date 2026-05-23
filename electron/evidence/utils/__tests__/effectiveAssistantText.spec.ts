import { describe, it, expect } from 'vitest';
import { effectiveAssistantText } from '../effectiveAssistantText';

describe('effectiveAssistantText', () => {
  it('returns empty string when both inputs are empty', () => {
    expect(effectiveAssistantText('', [])).toBe('');
    expect(effectiveAssistantText(undefined, undefined)).toBe('');
  });

  it('returns assistant_response as-is when no tool calls', () => {
    expect(effectiveAssistantText('hello world', [])).toBe('hello world');
    expect(effectiveAssistantText('hello world', undefined)).toBe('hello world');
  });

  it('returns concatenated tool inputs when assistant_response is empty', () => {
    const tools = [
      { index: 0, name: 'Bash', input_summary: 'grep proxyProvisioning' },
      { index: 1, name: 'Read', input_summary: '/CLAUDE.md' },
    ];
    expect(effectiveAssistantText('', tools)).toBe('grep proxyProvisioning\n/CLAUDE.md');
  });

  it('joins assistant_response with tool inputs when both are present', () => {
    const tools = [{ index: 0, name: 'Bash', input_summary: 'ls -la' }];
    expect(effectiveAssistantText('done.', tools)).toBe('done.\nls -la');
  });

  it('skips empty input_summary entries', () => {
    const tools = [
      { index: 0, name: 'Bash', input_summary: '' },
      { index: 1, name: 'Read', input_summary: '/file.md' },
    ];
    expect(effectiveAssistantText('', tools)).toBe('/file.md');
  });
});
