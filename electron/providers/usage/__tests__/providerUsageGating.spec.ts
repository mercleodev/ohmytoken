import { describe, expect, it, vi } from 'vitest';
import { resolveProviderUsageRequest } from '../providerUsageGating';
import type { ProviderUsageSnapshot } from '../types';

const makeSnapshot = (): ProviderUsageSnapshot => ({
  provider: 'claude',
  displayName: 'Claude',
  windows: [
    {
      label: 'Session',
      usedPercent: 42,
      leftPercent: 58,
      resetsAt: new Date(Date.now() + 3_600_000).toISOString(),
      resetDescription: 'Resets in 1h',
    },
  ],
  identity: { email: null, plan: 'Pro' },
  cost: null,
  updatedAt: new Date().toISOString(),
  source: 'oauth',
});

describe('resolveProviderUsageRequest', () => {
  it('returns null when account-insights opt-in is absent', async () => {
    const getCached = vi.fn();
    const refresh = vi.fn();

    const result = await resolveProviderUsageRequest(
      { accountInsights: {} },
      'claude',
      { getCached, refresh },
    );

    expect(result).toBeNull();
    expect(getCached).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('returns null when settings is undefined', async () => {
    const getCached = vi.fn();
    const refresh = vi.fn();

    const result = await resolveProviderUsageRequest(undefined, 'claude', {
      getCached,
      refresh,
    });

    expect(result).toBeNull();
    expect(getCached).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('returns null when the specific provider is not opted in', async () => {
    const getCached = vi.fn();
    const refresh = vi.fn();

    const result = await resolveProviderUsageRequest(
      { accountInsights: { codex: true } },
      'claude',
      { getCached, refresh },
    );

    expect(result).toBeNull();
    expect(getCached).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('returns cached snapshot when opted in and cache is present', async () => {
    const snap = makeSnapshot();
    const getCached = vi.fn(() => snap);
    const refresh = vi.fn();

    const result = await resolveProviderUsageRequest(
      { accountInsights: { claude: true } },
      'claude',
      { getCached, refresh },
    );

    expect(result).toBe(snap);
    expect(getCached).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('falls through to refresh when opted in and no cache', async () => {
    const snap = makeSnapshot();
    const getCached = vi.fn(() => null);
    const refresh = vi.fn(async () => snap);

    const result = await resolveProviderUsageRequest(
      { accountInsights: { claude: true } },
      'claude',
      { getCached, refresh },
    );

    expect(result).toBe(snap);
    expect(getCached).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('returns null when refresh resolves with null (fetch failure, opted in)', async () => {
    const getCached = vi.fn(() => null);
    const refresh = vi.fn(async () => null);

    const result = await resolveProviderUsageRequest(
      { accountInsights: { claude: true } },
      'claude',
      { getCached, refresh },
    );

    expect(result).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
