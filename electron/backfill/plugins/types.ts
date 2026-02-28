/**
 * Provider Plugin Interface
 *
 * Each provider (Claude, Codex, Gemini) implements this interface
 * to plug into the backfill engine. The engine iterates all registered
 * plugins and delegates scanning/parsing to the appropriate one.
 */
import type { BackfillMessage, BackfillClient, ScanFileEntry } from "../types";

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
};
