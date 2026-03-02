/**
 * Provider Session Watcher
 *
 * Generic fs.watch layer for providers that declare a watchConfig
 * in their ProviderPlugin. Watches session directories recursively
 * and triggers provider-scoped gap-fill on file changes for
 * near-real-time import.
 *
 * Providers with their own watcher (e.g. Claude's historyWatcher)
 * do not declare watchConfig and are unaffected.
 */
import * as fs from "fs";
import * as path from "path";
import { BrowserWindow } from "electron";
import { getAllPlugins } from "../backfill/plugins/registry";
import { runProviderGapFill, importProviderFile } from "../backfill/index";

const DEBOUNCE_MS = 1000;
const DEFAULT_PATTERN = /\.jsonl$/;

type WatcherState = {
  watcher: fs.FSWatcher;
  providerId: string;
  timer: ReturnType<typeof setTimeout> | null;
};

/**
 * Start watching session directories for all providers that declare watchConfig.
 * Returns a cleanup function that closes all watchers.
 */
export const startProviderSessionWatcher = (
  getMainWindow: () => BrowserWindow | null,
): (() => void) => {
  const states: WatcherState[] = [];
  const plugins = getAllPlugins();

  for (const plugin of plugins) {
    if (!plugin.watchConfig) continue;

    const { dir, filePattern } = plugin.watchConfig;
    const pattern = filePattern ?? DEFAULT_PATTERN;

    if (!fs.existsSync(dir)) {
      console.log(
        `[SessionWatcher] Skip ${plugin.id}: ${dir} not found`,
      );
      continue;
    }

    const state: WatcherState = {
      watcher: null as unknown as fs.FSWatcher,
      providerId: plugin.id,
      timer: null,
    };

    const onFileChange = (filename: string | null) => {
      console.log(
        `[SessionWatcher] ${plugin.id} change detected: ${filename ?? "(null)"}`,
      );
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => {
        try {
          // Direct file import when filename is known — bypasses mtime filter
          // to avoid race where scan timestamp advances past active file mtime.
          // Falls back to gap-fill when filename is unavailable.
          const result = filename
            ? importProviderFile(plugin.id, path.join(dir, filename))
            : runProviderGapFill(plugin.id);
          if (result.insertedMessages > 0) {
            console.log(
              `[SessionWatcher] ${plugin.id}: ${result.insertedMessages} new prompts (${result.durationMs}ms)`,
            );
            const win = getMainWindow();
            if (win && !win.isDestroyed()) {
              win.webContents.send("backfill:complete", result);
            }
          } else {
            console.log(
              `[SessionWatcher] ${plugin.id}: no new prompts (${result.durationMs}ms)`,
            );
          }
        } catch (err) {
          console.error(
            `[SessionWatcher] ${plugin.id} gap-fill error:`,
            err,
          );
        }
      }, DEBOUNCE_MS);
    };

    try {
      state.watcher = fs.watch(
        dir,
        { recursive: true },
        (_event, filename) => {
          // If filename is null (macOS edge case), still trigger gap-fill
          // since dedup will handle any false positives safely
          if (!filename || pattern.test(filename)) {
            onFileChange(filename);
          }
        },
      );

      states.push(state);
      console.log(`[SessionWatcher] Watching ${plugin.id}: ${dir}`);
    } catch (err) {
      console.error(
        `[SessionWatcher] Failed to watch ${plugin.id}:`,
        err,
      );
    }
  }

  return () => {
    for (const s of states) {
      s.watcher.close();
      if (s.timer) clearTimeout(s.timer);
    }
    if (states.length > 0) {
      console.log("[SessionWatcher] All watchers closed");
    }
  };
};
