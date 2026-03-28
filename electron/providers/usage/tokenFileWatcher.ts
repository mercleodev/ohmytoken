import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';
import { TOKEN_FILE_PATHS, getProviderTokenStatus } from './credentialReader';
import { UsageProviderType } from './types';

type WatcherCleanup = () => void;
type TokenChangeCallback = (provider: UsageProviderType) => void;

type WatcherOptions = {
  getMainWindow: () => BrowserWindow | null;
  onTokenChanged?: TokenChangeCallback;
};

/**
 * Watches token file changes for all 3 providers.
 * When a file is created/modified, sends a 'provider-token-changed' event to mainWindow,
 * and also calls the onTokenChanged callback if provided (for tray sync).
 *
 * For providers that store credentials in macOS Keychain (claude),
 * a periodic poll supplements file watching since Keychain changes
 * do not trigger filesystem events.
 */
export const startTokenFileWatcher = (
  getMainWindowOrOptions: (() => BrowserWindow | null) | WatcherOptions
): WatcherCleanup => {
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

    // Skip if directory doesn't exist (CLI not installed)
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

  // Keychain poll: claude stores credentials in macOS Keychain as priority 1.
  // File watcher cannot detect Keychain changes, so poll every 10s.
  const KEYCHAIN_POLL_MS = 10_000;
  let lastKeychainHasToken: boolean | null = null;
  let lastKeychainExpired: boolean | null = null;

  const pollKeychain = () => {
    try {
      const status = getProviderTokenStatus('claude');
      const changed =
        lastKeychainHasToken !== null &&
        (status.hasToken !== lastKeychainHasToken || status.tokenExpired !== lastKeychainExpired);

      lastKeychainHasToken = status.hasToken;
      lastKeychainExpired = status.tokenExpired;

      if (changed) {
        console.log(`[TokenWatcher] claude keychain status changed (hasToken=${status.hasToken}, expired=${status.tokenExpired})`);
        emitChange('claude');
      }
    } catch {
      // Keychain poll error — ignore silently
    }
  };

  // Initialize baseline state immediately
  pollKeychain();
  const keychainTimer = setInterval(pollKeychain, KEYCHAIN_POLL_MS);

  // Return cleanup function
  return () => {
    clearInterval(keychainTimer);
    for (const watcher of watchers) {
      watcher.close();
    }
    console.log('[TokenWatcher] All watchers closed');
  };
};
