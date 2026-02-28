/**
 * Codex Provider Plugin
 *
 * Wraps the Codex scanner and parser into the ProviderPlugin interface.
 * Pure delegation — no new logic beyond the plugin contract.
 */
import type { ProviderPlugin } from "./types";
import { findCodexSessionFiles, countCodexSessionFiles } from "../codex-scanner";
import { parseCodexSessionFile } from "../parsers/codex";
import type { ScanFileEntry, BackfillMessage } from "../types";

export const codexPlugin: ProviderPlugin = {
  id: "codex",
  displayName: "Codex",

  scan(lastScanTimestampMs?: number | null): ScanFileEntry[] {
    return findCodexSessionFiles(lastScanTimestampMs);
  },

  count(): number {
    return countCodexSessionFiles();
  },

  parse(entry: ScanFileEntry): BackfillMessage[] {
    return parseCodexSessionFile(entry.filePath, entry.sessionId, entry.projectDir);
  },
};
