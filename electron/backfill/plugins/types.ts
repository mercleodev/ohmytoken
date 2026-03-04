/**
 * Provider Plugin Interface
 *
 * Each provider (Claude, Codex, Gemini) implements this interface
 * to plug into the backfill engine. The engine iterates all registered
 * plugins and delegates scanning/parsing to the appropriate one.
 */
import type { BackfillMessage, BackfillClient, ScanFileEntry } from "../types";

/**
 * Configuration for real-time file-change detection.
 * Providers that need instant session detection declare this;
 * the generic providerSessionWatcher picks it up automatically.
 */
export type WatchConfig = {
  /** Directory to watch recursively for session file changes */
  dir: string;
  /** File pattern to filter watch events (default: /\.jsonl$/) */
  filePattern?: RegExp;
  /**
   * Optional trigger file that is written to on every user turn
   * (e.g. ~/.codex/history.jsonl). When this file changes, the watcher
   * triggers a gap-fill even if the session directory watcher missed
   * the write. Solves the problem where session files are flushed
   * asynchronously after the trigger file.
   */
  triggerFile?: string;
};

export type ProviderPlugin = {
  /** Unique provider identifier */
  id: BackfillClient;

  /** Human-readable name for UI display */
  displayName: string;

  /** Discover session files, optionally filtered by mtime */
  scan(lastScanTimestampMs?: number | null): ScanFileEntry[];

  /** Count total available session files (for onboarding dialog) */
  count(): number;

  /** Parse a single session file into normalized BackfillMessages */
  parse(entry: ScanFileEntry): BackfillMessage[];

  /**
   * Optional: build a ScanFileEntry from a single file path.
   * Used by the real-time watcher for direct file import,
   * bypassing mtime-based scanning.
   */
  buildEntry?(filePath: string): ScanFileEntry | null;

  /**
   * Optional: real-time file-change detection config.
   * Providers with their own watcher (e.g. Claude's historyWatcher)
   * should NOT set this to avoid duplicate detection.
   */
  watchConfig?: WatchConfig;
};
