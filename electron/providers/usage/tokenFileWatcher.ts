import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';
import { TOKEN_FILE_PATHS } from './credentialReader';
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

        // Debounce: ignore duplicate events within 1 second
        const now = Date.now();
        if (lastEmit[provider] && now - lastEmit[provider] < DEBOUNCE_MS) return;
        lastEmit[provider] = now;

        console.log(`[TokenWatcher] ${provider} token file changed (${eventType})`);
        const mainWindow = options.getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('provider-token-changed', provider);
        }
        // Tray sync callback
        options.onTokenChanged?.(provider);
      });

      watchers.push(watcher);
      console.log(`[TokenWatcher] Watching ${provider}: ${filePath}`);
    } catch (err) {
      console.error(`[TokenWatcher] Failed to watch ${provider}:`, err);
    }
  }

  // Return cleanup function
  return () => {
    for (const watcher of watchers) {
      watcher.close();
    }
    console.log('[TokenWatcher] All watchers closed');
  };
};
