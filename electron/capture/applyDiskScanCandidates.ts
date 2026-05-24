/**
 * Transport-agnostic helper that merges transcript-derived `InjectedFile`
 * entries with disk-scan candidates from `<cwd>/.claude/{rules,memory,skills}`
 * and `<homeDir>/.claude/{rules,memory,skills}`.
 *
 * Issue #367: prompt rows were diverging between the Stop-hook path
 * (full disk-scan via #364) and the history-import path
 * (`nested_memories` only — disk-scan was missing). Sharing this helper
 * lets both paths produce the same candidate pool so the existing
 * `prompts.request_id UNIQUE` + `INSERT OR IGNORE` dedup yields exactly
 * one row per logical turn with the full data attached.
 *
 * Path collision policy: seed entries WIN. If the same absolute path
 * appears in both inputs, the seed's `category` and `estimated_tokens`
 * are preserved — they came from a transcript-confirmed source (nested
 * memory, classified system reminder, etc.) and carry more accurate
 * categorization than the heuristic disk-scan can infer.
 */

import type { InjectedFile } from "../proxy/types";
import { collectDotClaudeFiles } from "../hooks/dotClaudeScanner";

export const applyDiskScanCandidates = (
  seed: InjectedFile[],
  cwd: string | undefined,
  homeDir: string | undefined,
): InjectedFile[] => {
  const seen = new Set<string>();
  const merged: InjectedFile[] = [];

  for (const entry of seed) {
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    merged.push(entry);
  }

  for (const entry of collectDotClaudeFiles(cwd)) {
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    merged.push(entry);
  }

  for (const entry of collectDotClaudeFiles(homeDir)) {
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    merged.push(entry);
  }

  return merged;
};
