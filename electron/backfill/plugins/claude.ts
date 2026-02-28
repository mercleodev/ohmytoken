/**
 * Claude Provider Plugin
 *
 * Wraps the existing scanner and parser as a ProviderPlugin.
 * No logic changes — pure delegation to scanner.ts and parsers/claude.ts.
 */
import type { ProviderPlugin } from "./types";
import { findClaudeSessionFiles, countSessionFiles } from "../scanner";
import { parseClaudeSessionFile } from "../parsers/claude";
import type { ScanFileEntry, BackfillMessage } from "../types";

export const claudePlugin: ProviderPlugin = {
  id: "claude",
  displayName: "Claude Code",

  scan(lastScanTimestampMs?: number | null): ScanFileEntry[] {
    return findClaudeSessionFiles(lastScanTimestampMs);
  },

  count(): number {
    return countSessionFiles();
  },

  parse(entry: ScanFileEntry): BackfillMessage[] {
    return parseClaudeSessionFile(
      entry.filePath,
      entry.sessionId,
      entry.projectDir,
    );
  },
};
