import { describe, it, expect } from 'vitest';
import {
  isAccountInsightsEnabled,
  getOptedInProviders,
  setAccountInsightsEnabled,
} from '../accountInsightsSettings';

describe('accountInsightsSettings', () => {
  it('treats missing settings as fully opted-out', () => {
    expect(isAccountInsightsEnabled(undefined, 'claude')).toBe(false);
    expect(isAccountInsightsEnabled(null, 'codex')).toBe(false);
    expect(isAccountInsightsEnabled({}, 'gemini')).toBe(false);
    expect(getOptedInProviders(undefined)).toEqual([]);
    expect(getOptedInProviders({ accountInsights: {} })).toEqual([]);
  });

  it('only treats explicit true as opted-in', () => {
    const s = { accountInsights: { claude: false, codex: true } };
    expect(isAccountInsightsEnabled(s, 'claude')).toBe(false);
    expect(isAccountInsightsEnabled(s, 'codex')).toBe(true);
    expect(isAccountInsightsEnabled(s, 'gemini')).toBe(false);
    expect(getOptedInProviders(s)).toEqual(['codex']);
  });

  it('returns providers in canonical order regardless of insertion order', () => {
    const s = {
      accountInsights: { gemini: true, claude: true, codex: true },
    };
    expect(getOptedInProviders(s)).toEqual(['claude', 'codex', 'gemini']);
  });

  it('setAccountInsightsEnabled returns a new map with only the target changed', () => {
    const s = { accountInsights: { claude: true, codex: true } };
    const next = setAccountInsightsEnabled(s, 'claude', false);
    expect(next).toEqual({ claude: false, codex: true });
    expect(s.accountInsights).toEqual({ claude: true, codex: true });
  });

  it('setAccountInsightsEnabled handles missing map', () => {
    expect(setAccountInsightsEnabled(undefined, 'gemini', true)).toEqual({
      gemini: true,
    });
    expect(setAccountInsightsEnabled({}, 'gemini', true)).toEqual({
      gemini: true,
    });
  });
});
