import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';
import { TOKEN_FILE_PATHS, getProviderTokenStatus } from './credentialReader';
import { UsageProviderType } from './types';

type TokenChangeCallback = (provider: UsageProviderType) => void;

type WatcherOptions = {
  getMainWindow: () => BrowserWindow | null;
  onTokenChanged?: TokenChangeCallback;
  // Phase 3 — Keychain polling is opt-in only. If omitted, poll stays off
  // at boot and must be started explicitly via `startKeychainPoll()`.
  isClaudeInsightsEnabled?: () => boolean;
};

export type TokenFileWatcherHandle = {
  cleanup: () => void;
  startKeychainPoll: () => void;
  stopKeychainPoll: () => void;
  isKeychainPollActive: () => boolean;
};

/**
 * Watches token file changes for all 3 providers.
 *
 * Passive file watchers (Codex auth, Gemini oauth_creds) always run — they
 * cannot trigger Keychain prompts. Claude's credentials live primarily in
 * macOS Keychain, so a 10s poll is required to detect changes there; that
 * poll is gated behind the Phase 3 account-insights opt-in and can be
 * toggled at runtime via `startKeychainPoll()` / `stopKeychainPoll()`.
 */
export const startTokenFileWatcher = (
  getMainWindowOrOptions: (() => BrowserWindow | null) | WatcherOptions,
): TokenFileWatcherHandle => {
  const options: WatcherOptions = typeof getMainWindowOrOptions === 'function'
    ? { getMainWindow: getMainWindowOrOptions }
    : getMainWindowOrOptions;
  const watchers: fs.FSWatcher[] = [];
  const DEBOUNCE_MS = 1000;
  const lastEmit: Record<string, number> = {};

  const providers: UsageProviderType[] = ['claude', 'codex', 'gemini'];

  const emitChange = (provider: UsageProviderType) => {
    const now = Date.now();
    if (lastEmit[provider] && now - lastEmit[provider] < DEBOUNCE_MS) return;
    lastEmit[provider] = now;

    const mainWindow = options.getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('provider-token-changed', provider);
    }
    options.onTokenChanged?.(provider);
  };

  for (const provider of providers) {
    const filePath = TOKEN_FILE_PATHS[provider];
    const dir = path.dirname(filePath);
    const filename = path.basename(filePath);

    if (!fs.existsSync(dir)) {
      console.log(`[TokenWatcher] Skip ${provider}: directory ${dir} not found`);
      continue;
    }

    try {
      const watcher = fs.watch(dir, (eventType, changedFile) => {
        if (changedFile !== filename) return;
        console.log(`[TokenWatcher] ${provider} token file changed (${eventType})`);
        emitChange(provider);
      });

      watchers.push(watcher);
      console.log(`[TokenWatcher] Watching ${provider}: ${filePath}`);
    } catch (err) {
      console.error(`[TokenWatcher] Failed to watch ${provider}:`, err);
    }
  }

  // Keychain poll (Claude) — opt-in gated. We do NOT start `setInterval`
  // at boot unless the user has explicitly enabled Claude account insights.
  const KEYCHAIN_POLL_MS = 10_000;
  let keychainTimer: NodeJS.Timeout | null = null;
  let lastKeychainHasToken: boolean | null = null;
  let lastKeychainExpired: boolean | null = null;

  const pollKeychain = () => {
    try {
      const status = getProviderTokenStatus('claude');
      const changed =
        lastKeychainHasToken !== null &&
        (status.hasToken !== lastKeychainHasToken ||
          status.tokenExpired !== lastKeychainExpired);

      lastKeychainHasToken = status.hasToken;
      lastKeychainExpired = status.tokenExpired;

      if (changed) {
        console.log(
          `[TokenWatcher] claude keychain status changed (hasToken=${status.hasToken}, expired=${status.tokenExpired})`,
        );
        emitChange('claude');
      }
    } catch {
      // Keychain poll error — ignore silently
    }
  };

  const startKeychainPoll = () => {
    if (keychainTimer !== null) return;
    pollKeychain(); // establish baseline immediately
    keychainTimer = setInterval(pollKeychain, KEYCHAIN_POLL_MS);
    console.log('[TokenWatcher] Keychain poll started (Claude opt-in)');
  };

  const stopKeychainPoll = () => {
    if (keychainTimer === null) return;
    clearInterval(keychainTimer);
    keychainTimer = null;
    lastKeychainHasToken = null;
    lastKeychainExpired = null;
    console.log('[TokenWatcher] Keychain poll stopped');
  };

  const isKeychainPollActive = () => keychainTimer !== null;

  // If Claude insights are already opted in (e.g., after a restart), start the
  // poll. Otherwise stay quiet until the renderer invokes `:connect`.
  if (options.isClaudeInsightsEnabled?.() === true) {
    startKeychainPoll();
  }

  const cleanup = () => {
    stopKeychainPoll();
    for (const watcher of watchers) watcher.close();
    console.log('[TokenWatcher] All watchers closed');
  };

  return { cleanup, startKeychainPoll, stopKeychainPoll, isKeychainPollActive };
};
