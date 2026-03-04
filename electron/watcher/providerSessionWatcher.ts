/**
 * Provider Session Watcher
 *
 * Generic fs.watch layer for providers that declare a watchConfig
 * in their ProviderPlugin.
 *
 * Two detection strategies:
 * 1. Directory watcher (recursive) — catches session file writes directly.
 * 2. Trigger file watcher — watches a lightweight file (e.g. history.jsonl)
 *    that is written on every user turn. When the trigger fires, a temporary
 *    fs.watch is placed on the resolved session file so the import happens
 *    the instant Codex flushes it — no polling, no retry intervals.
 *
 * Providers with their own watcher (e.g. Claude's historyWatcher)
 * do not declare watchConfig and are unaffected.
 */
import * as fs from "fs";
import * as path from "path";
import { BrowserWindow } from "electron";
import { getAllPlugins } from "../backfill/plugins/registry";
import { runProviderGapFill, importProviderFile } from "../backfill/index";
import { findSessionFileBySessionId } from "../backfill/codex-scanner";

const DEBOUNCE_MS = 1000;
const TRIGGER_DEBOUNCE_MS = 500;
const DEFAULT_PATTERN = /\.jsonl$/;

/** Max time to keep a per-file watcher alive (ms) */
const FILE_WATCH_TIMEOUT_MS = 90_000;

type Cleanup = () => void;

/**
 * Read the last line of a file to extract a session_id.
 * Codex history.jsonl format: {"session_id":"...","ts":...,"text":"..."}
 */
const readLastSessionId = (filePath: string): string | null => {
  try {
    const stat = fs.statSync(filePath);
    const readSize = Math.min(4096, stat.size);
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);

    const text = buf.toString("utf-8");
    const lines = text.trim().split("\n");
    const lastLine = lines[lines.length - 1];
    const obj = JSON.parse(lastLine);
    return obj.session_id ?? null;
  } catch {
    return null;
  }
};

/**
 * Start watching session directories for all providers that declare watchConfig.
 * Returns a cleanup function that closes all watchers.
 */
export const startProviderSessionWatcher = (
  getMainWindow: () => BrowserWindow | null,
): (() => void) => {
  const cleanups: Cleanup[] = [];
  const plugins = getAllPlugins();

  for (const plugin of plugins) {
    if (!plugin.watchConfig) continue;

    const { dir, filePattern, triggerFile } = plugin.watchConfig;
    const pattern = filePattern ?? DEFAULT_PATTERN;

    const notifyFrontend = (inserted: number, durationMs: number) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send("backfill:complete", { insertedMessages: inserted, durationMs });
      }
    };

    // --- Directory watcher (catches direct session file writes) ---
    if (fs.existsSync(dir)) {
      let dirTimer: ReturnType<typeof setTimeout> | null = null;

      const onFileChange = (filename: string | null) => {
        console.log(
          `[SessionWatcher] ${plugin.id} dir change: ${filename ?? "(null)"}`,
        );
        if (dirTimer) clearTimeout(dirTimer);
        dirTimer = setTimeout(() => {
          try {
            const result = filename
              ? importProviderFile(plugin.id, path.join(dir, filename))
              : runProviderGapFill(plugin.id);
            if (result.insertedMessages > 0) {
              console.log(
                `[SessionWatcher] ${plugin.id} dir: ${result.insertedMessages} new prompts (${result.durationMs}ms)`,
              );
              notifyFrontend(result.insertedMessages, result.durationMs);
            }
          } catch (err) {
            console.error(`[SessionWatcher] ${plugin.id} dir error:`, err);
          }
        }, DEBOUNCE_MS);
      };

      try {
        const watcher = fs.watch(
          dir,
          { recursive: true },
          (_event, filename) => {
            if (!filename || pattern.test(filename)) {
              onFileChange(filename);
            }
          },
        );
        cleanups.push(() => {
          watcher.close();
          if (dirTimer) clearTimeout(dirTimer);
        });
        console.log(`[SessionWatcher] Watching ${plugin.id} dir: ${dir}`);
      } catch (err) {
        console.error(`[SessionWatcher] Failed to watch ${plugin.id} dir:`, err);
      }
    }

    // --- Trigger file watcher → per-session-file watch for instant detection ---
    if (triggerFile && fs.existsSync(triggerFile)) {
      let triggerTimer: ReturnType<typeof setTimeout> | null = null;
      // Active per-file watcher from previous trigger (cleaned up on next trigger)
      let activeFileWatcher: fs.FSWatcher | null = null;
      let activeFileTimeout: ReturnType<typeof setTimeout> | null = null;

      const cleanupFileWatch = () => {
        if (activeFileWatcher) {
          activeFileWatcher.close();
          activeFileWatcher = null;
        }
        if (activeFileTimeout) {
          clearTimeout(activeFileTimeout);
          activeFileTimeout = null;
        }
      };

      const tryImportAndNotify = (sessionFile: string, source: string): boolean => {
        try {
          const result = importProviderFile(plugin.id, sessionFile);
          if (result.insertedMessages > 0) {
            console.log(
              `[SessionWatcher] ${plugin.id} ${source}: ${result.insertedMessages} new prompts (${result.durationMs}ms)`,
            );
            notifyFrontend(result.insertedMessages, result.durationMs);
            return true;
          }
        } catch (err) {
          console.error(`[SessionWatcher] ${plugin.id} ${source} error:`, err);
        }
        return false;
      };

      const onTrigger = () => {
        if (triggerTimer) clearTimeout(triggerTimer);

        triggerTimer = setTimeout(() => {
          const sessionId = readLastSessionId(triggerFile);
          if (!sessionId) return;

          const sessionFile = findSessionFileBySessionId(sessionId);
          if (!sessionFile) return;

          console.log(
            `[SessionWatcher] ${plugin.id} trigger: session=${sessionId.slice(0, 12)}…`,
          );

          // Try immediately — session file might already be flushed
          if (tryImportAndNotify(sessionFile, "trigger")) return;

          // Not flushed yet — watch the session file directly.
          // Single-file fs.watch is reliable on macOS (unlike recursive dir watch).
          cleanupFileWatch();

          console.log(
            `[SessionWatcher] ${plugin.id} watching session file for flush…`,
          );

          let fileDebounce: ReturnType<typeof setTimeout> | null = null;

          activeFileWatcher = fs.watch(sessionFile, () => {
            // Debounce rapid writes (Codex may write multiple chunks)
            if (fileDebounce) clearTimeout(fileDebounce);
            fileDebounce = setTimeout(() => {
              if (tryImportAndNotify(sessionFile, "file-watch")) {
                cleanupFileWatch();
              }
            }, DEBOUNCE_MS);
          });

          // Timeout: stop watching after 90s
          activeFileTimeout = setTimeout(() => {
            console.log(
              `[SessionWatcher] ${plugin.id} file-watch timeout, closing`,
            );
            cleanupFileWatch();
          }, FILE_WATCH_TIMEOUT_MS);
        }, TRIGGER_DEBOUNCE_MS);
      };

      try {
        const watcher = fs.watch(triggerFile, () => onTrigger());
        cleanups.push(() => {
          watcher.close();
          if (triggerTimer) clearTimeout(triggerTimer);
          cleanupFileWatch();
        });
        console.log(
          `[SessionWatcher] Watching ${plugin.id} trigger: ${triggerFile}`,
        );
      } catch (err) {
        console.error(
          `[SessionWatcher] Failed to watch ${plugin.id} trigger:`,
          err,
        );
      }
    }
  }

  return () => {
    for (const fn of cleanups) fn();
    if (cleanups.length > 0) {
      console.log("[SessionWatcher] All watchers closed");
    }
  };
};
