import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('buildProviderConnectionStatus', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('child_process', () => ({
      execSync: () => { throw new Error('keychain access blocked in test'); },
    }));
  });

  const loadModule = async (fsOverrides: Partial<{ existsSync: (p: string) => boolean }> = {}) => {
    vi.doMock('fs', async () => {
      const actual = await vi.importActual<typeof import('fs')>('fs');
      return { ...actual, existsSync: fsOverrides.existsSync ?? (() => false) };
    });
    return import('../credentialReader');
  };

  it('reports not_enabled when no session root and no DB data', async () => {
    const mod = await loadModule({ existsSync: () => false });
    const status = mod.buildProviderConnectionStatus('claude', () => ({
      promptCount: 0,
      lastTrackedAt: null,
      watcherFired: false,
    }));
    expect(status.tracking).toBe('not_enabled');
    expect(status.accountInsights).toBe('not_connected');
  });

  it('reports waiting_for_activity when session root exists but no events', async () => {
    const mod = await loadModule({ existsSync: () => true });
    const status = mod.buildProviderConnectionStatus('codex', () => ({
      promptCount: 0,
      lastTrackedAt: null,
      watcherFired: false,
    }));
    expect(status.tracking).toBe('waiting_for_activity');
  });

  it('reports active when DB has historical prompts', async () => {
    const mod = await loadModule({ existsSync: () => true });
    const status = mod.buildProviderConnectionStatus('codex', () => ({
      promptCount: 12,
      lastTrackedAt: '2026-04-19T00:00:00Z',
      watcherFired: false,
    }));
    expect(status.tracking).toBe('active');
    expect(status.lastTrackedAt).toBe('2026-04-19T00:00:00Z');
  });

  it('reports active when watcher fired during the current process lifetime', async () => {
    const mod = await loadModule({ existsSync: () => true });
    const status = mod.buildProviderConnectionStatus('gemini', () => ({
      promptCount: 0,
      lastTrackedAt: null,
      watcherFired: true,
    }));
    expect(status.tracking).toBe('active');
  });

  it('iterates all three providers via buildAllProviderConnectionStatuses', async () => {
    const mod = await loadModule({ existsSync: () => true });
    const statuses = mod.buildAllProviderConnectionStatuses(() => ({
      promptCount: 1,
      lastTrackedAt: null,
      watcherFired: false,
    }));
    expect(statuses.map((s) => s.provider)).toEqual(['claude', 'codex', 'gemini']);
    for (const s of statuses) expect(s.tracking).toBe('active');
  });
});
