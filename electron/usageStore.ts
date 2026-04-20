import { ProviderUsageSnapshot, UsageProviderType } from './providers/usage/types';
import { getProviderCostSummary } from './db/reader';

type OnChangeCallback = (provider: UsageProviderType, snapshot: ProviderUsageSnapshot | null) => void;

const snapshotCache: Record<string, ProviderUsageSnapshot | null> = {};
const listeners: OnChangeCallback[] = [];
let pollingTimer: NodeJS.Timeout | null = null;
let resetTimer: NodeJS.Timeout | null = null;

const getSnapshot = (provider: UsageProviderType): ProviderUsageSnapshot | null =>
  snapshotCache[provider] ?? null;

const emitChange = (provider: UsageProviderType, snapshot: ProviderUsageSnapshot | null): void => {
  for (const cb of listeners) {
    try { cb(provider, snapshot); } catch (err) {
      console.error('[UsageStore] onChange callback error:', err);
    }
  }
};

const fetchByProvider = async (provider: UsageProviderType): Promise<ProviderUsageSnapshot | null> => {
  if (provider === 'claude') {
    const { fetchClaudeUsage } = require('./providers/usage/claude/usageFetcher');
    return await fetchClaudeUsage();
  }
  if (provider === 'codex') {
    const { fetchCodexUsage } = require('./providers/usage/codex/usageFetcher');
    return await fetchCodexUsage();
  }
  if (provider === 'gemini') {
    const { fetchGeminiUsage } = require('./providers/usage/gemini/usageFetcher');
    return await fetchGeminiUsage();
  }
  return null;
};

// Schedule timer to re-fetch immediately when reset time arrives
const scheduleResetRefresh = (provider: UsageProviderType, snapshot: ProviderUsageSnapshot | null): void => {
  if (resetTimer) {
    clearTimeout(resetTimer);
    resetTimer = null;
  }
  if (!snapshot?.windows.length) return;

  const now = Date.now();
  let earliest = Infinity;
  for (const w of snapshot.windows) {
    if (!w.resetsAt) continue;
    const resetMs = new Date(w.resetsAt).getTime();
    if (resetMs > now && resetMs < earliest) earliest = resetMs;
  }

  if (earliest === Infinity) return;

  // Auto re-fetch 3 seconds after reset time (wait for API to reflect)
  const delay = earliest - now + 3000;
  console.log(`[UsageStore] Reset refresh scheduled in ${Math.round(delay / 1000)}s`);
  resetTimer = setTimeout(() => {
    resetTimer = null;
    refresh(provider);
  }, delay);
};

const refresh = async (provider: UsageProviderType): Promise<ProviderUsageSnapshot | null> => {
  try {
    const snapshot = await fetchByProvider(provider);
    if (snapshot) {
      try {
        snapshot.cost = getProviderCostSummary(provider);
      } catch (err) {
        console.warn(`[UsageStore] cost enrichment failed for ${provider}:`, err);
      }
      snapshotCache[provider] = snapshot;
      emitChange(provider, snapshot);
      scheduleResetRefresh(provider, snapshot);
    } else if (!snapshotCache[provider]) {
      // Only emit null if there's no existing cached snapshot
      // This prevents overwriting a valid snapshot with null during rate-limit
      emitChange(provider, null);
    }
    return snapshot ?? snapshotCache[provider] ?? null;
  } catch (err) {
    console.error(`[UsageStore] refresh(${provider}) failed:`, err);
    return snapshotCache[provider] ?? null;
  }
};

const ALL_PROVIDERS: UsageProviderType[] = ['claude', 'codex', 'gemini'];

// Phase 3 — polling iterates only opted-in providers. The getter is read
// every tick so opt-in changes take effect on the next interval.
let getPollingProviders: () => UsageProviderType[] = () => ALL_PROVIDERS;

const refreshAll = async (): Promise<void> => {
  const providers = getPollingProviders();
  if (providers.length === 0) return;
  await Promise.allSettled(providers.map((p) => refresh(p)));
};

const startPolling = (
  intervalMin: number,
  providersGetter: () => UsageProviderType[] = () => ALL_PROVIDERS,
): void => {
  stopPolling();
  getPollingProviders = providersGetter;
  const ms = intervalMin * 60 * 1000;
  pollingTimer = setInterval(() => {
    refreshAll();
  }, ms);
};

const clearSnapshot = (provider: UsageProviderType): void => {
  if (!(provider in snapshotCache)) return;
  delete snapshotCache[provider];
  emitChange(provider, null);
};

const stopPolling = (): void => {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
  if (resetTimer) {
    clearTimeout(resetTimer);
    resetTimer = null;
  }
};

const onChange = (callback: OnChangeCallback): (() => void) => {
  listeners.push(callback);
  return () => {
    const idx = listeners.indexOf(callback);
    if (idx >= 0) listeners.splice(idx, 1);
  };
};

export const usageStore = {
  getSnapshot,
  refresh,
  refreshAll,
  startPolling,
  stopPolling,
  clearSnapshot,
  onChange,
};
