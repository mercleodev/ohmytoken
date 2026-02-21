import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';

export type HistoryEntry = {
  display: string;
  timestamp: number;
  sessionId: string;
  project: string;
  // Enriched by main process (from session JSONL usage data)
  totalContextTokens?: number;
  model?: string;
};

type HistoryWatcherOptions = {
  onNewEntry: (entry: HistoryEntry) => void;
};

const HISTORY_FILE = path.join(homedir(), '.claude', 'history.jsonl');
const DEBOUNCE_MS = 1000;

let lastActiveSessionId = '';

export const getLastActiveSessionId = (): string => lastActiveSessionId;

/**
 * Reads the last N entries from history.jsonl.
 * Returns entries sorted newest-first.
 */
export const readRecentHistory = (limit = 50): HistoryEntry[] => {
  if (!fs.existsSync(HISTORY_FILE)) return [];

  try {
    const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
    const lines = content.trim().split('\n').filter((l) => l.trim());

    const entries: HistoryEntry[] = [];
    // Read from end for efficiency
    const start = Math.max(0, lines.length - limit);
    for (let i = start; i < lines.length; i++) {
      try {
        const raw = JSON.parse(lines[i]);
        if (raw.sessionId && raw.timestamp) {
          entries.push({
            display: raw.display || '',
            timestamp: raw.timestamp,
            sessionId: raw.sessionId,
            project: raw.project || '',
          });
        }
      } catch {
        // skip malformed lines
      }
    }

    entries.reverse();
    // Initialize lastActiveSessionId from most recent entry
    if (entries.length > 0 && !lastActiveSessionId) {
      lastActiveSessionId = entries[0].sessionId;
    }
    return entries;
  } catch {
    return [];
  }
};

/**
 * Watches ~/.claude/history.jsonl for new entries (tail-style).
 * Uses fs.watch + debounce pattern matching tokenFileWatcher.
 * Returns a cleanup function.
 */
export const startHistoryWatcher = (options: HistoryWatcherOptions): (() => void) => {
  const dir = path.dirname(HISTORY_FILE);
  const filename = path.basename(HISTORY_FILE);

  if (!fs.existsSync(dir)) {
    console.log('[HistoryWatcher] Skip: ~/.claude directory not found');
    return () => {};
  }

  let lastSize = 0;
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      lastSize = fs.statSync(HISTORY_FILE).size;
    }
  } catch {
    // file may not exist yet
  }

  let lastEmit = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const processNewData = () => {
    try {
      if (!fs.existsSync(HISTORY_FILE)) return;

      const stat = fs.statSync(HISTORY_FILE);
      if (stat.size <= lastSize) {
        // File was truncated or unchanged
        lastSize = stat.size;
        return;
      }

      // Read only the new bytes
      const fd = fs.openSync(HISTORY_FILE, 'r');
      const newBytes = stat.size - lastSize;
      const buffer = Buffer.alloc(newBytes);
      fs.readSync(fd, buffer, 0, newBytes, lastSize);
      fs.closeSync(fd);

      lastSize = stat.size;

      const newContent = buffer.toString('utf-8');
      const lines = newContent.trim().split('\n').filter((l) => l.trim());

      for (const line of lines) {
        try {
          const raw = JSON.parse(line);
          if (raw.sessionId && raw.timestamp) {
            lastActiveSessionId = raw.sessionId;
            options.onNewEntry({
              display: raw.display || '',
              timestamp: raw.timestamp,
              sessionId: raw.sessionId,
              project: raw.project || '',
            });
          }
        } catch {
          // skip malformed line
        }
      }
    } catch (err) {
      console.error('[HistoryWatcher] Error reading new data:', err);
    }
  };

  try {
    const watcher = fs.watch(dir, (eventType, changedFile) => {
      if (changedFile !== filename) return;

      const now = Date.now();
      if (now - lastEmit < DEBOUNCE_MS) return;
      lastEmit = now;

      // Debounce: wait for writes to settle
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(processNewData, 200);
    });

    console.log(`[HistoryWatcher] Watching ${HISTORY_FILE}`);

    return () => {
      watcher.close();
      if (debounceTimer) clearTimeout(debounceTimer);
      console.log('[HistoryWatcher] Watcher closed');
    };
  } catch (err) {
    console.error('[HistoryWatcher] Failed to start:', err);
    return () => {};
  }
};
