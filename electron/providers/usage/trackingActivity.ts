import { UsageProviderType } from './types';

/**
 * Per-process flag set: which providers have had at least one watcher event
 * since this app process started. Read by the connection-status IPC to decide
 * between `waiting_for_activity` and `active` states.
 *
 * Phase 2 — the only write path is watcher callbacks marking their provider.
 * Phase 3+ may feed richer signals (error counts, last-seen staleness) once
 * the UX distinguishes a `degraded` state.
 */
const watcherFired: Set<UsageProviderType> = new Set();

export const markProviderWatcherFired = (provider: UsageProviderType): void => {
  watcherFired.add(provider);
};

export const hasProviderWatcherFired = (provider: UsageProviderType): boolean =>
  watcherFired.has(provider);

export const resetProviderWatcherFlags = (): void => {
  watcherFired.clear();
};
