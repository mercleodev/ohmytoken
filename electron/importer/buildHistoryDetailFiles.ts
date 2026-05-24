/**
 * Build the `injected_files` list for `get-history-prompt-detail` IPC.
 *
 * Issue #376: the IPC handler in `electron/main.ts` previously assembled
 * its own list via inline `readdirSync` calls. That path skipped
 * `applyDiskScanCandidates` + `deriveExtraRoots`, so a `history` re-ingest
 * of a session opened from an external cwd lost every project-side rule,
 * memory, and skill file. The hook path already routes through the shared
 * disk-scan helpers — this module restores cross-transport parity for the
 * history detail path.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { InjectedFile } from "../proxy/types";
import { countTokens } from "../analyzer/tokenCounter";
import { applyDiskScanCandidates } from "../capture/applyDiskScanCandidates";
import { deriveExtraRoots } from "../capture/deriveExtraRoots";

export type BuildHistoryDetailFilesParams = {
  /** Decoded session cwd (e.g. `/proj/web`). May be empty. */
  projectPath: string | undefined;
  /** `os.homedir()` — overrideable for hermetic tests. */
  homeDir: string;
  /** Dash-encoded JSONL parent directory (e.g. `-Users-...-tving-web`). */
  projectDirName: string;
  /** `nested_memory` paths surfaced by the JSONL turn. */
  nestedMemoryPaths?: readonly string[];
};

const classifyCategory = (filePath: string): InjectedFile["category"] => {
  const lower = filePath.toLowerCase();
  if (lower.includes("/rules/")) return "rules";
  if (lower.includes("/memory/")) return "memory";
  if (lower.includes("/skills/") || lower.includes("/skill")) return "skill";
  if (lower.includes("claude.md")) {
    if (lower.includes("/.claude/") && !lower.includes("/projects/")) return "global";
    return "project";
  }
  return "project";
};

const readEntryIfExists = (
  filePath: string,
  category: InjectedFile["category"],
): InjectedFile | null => {
  try {
    if (!fs.existsSync(filePath)) return null;
    const tokens = countTokens(fs.readFileSync(filePath, "utf-8"));
    return { path: filePath, category, estimated_tokens: tokens };
  } catch {
    return null;
  }
};

const readDirMarkdown = (
  dirPath: string,
  category: InjectedFile["category"],
): InjectedFile[] => {
  const out: InjectedFile[] = [];
  try {
    if (!fs.existsSync(dirPath)) return out;
    for (const name of fs.readdirSync(dirPath)) {
      if (!name.endsWith(".md")) continue;
      const entry = readEntryIfExists(path.join(dirPath, name), category);
      if (entry) out.push(entry);
    }
  } catch {
    /* skip */
  }
  return out;
};

const collectSeed = (
  projectPath: string | undefined,
  homeDir: string,
  projectDirName: string,
): InjectedFile[] => {
  const seed: InjectedFile[] = [];
  const seen = new Set<string>();
  const push = (entry: InjectedFile | null): void => {
    if (!entry || seen.has(entry.path)) return;
    seen.add(entry.path);
    seed.push(entry);
  };

  push(readEntryIfExists(path.join(homeDir, ".claude", "CLAUDE.md"), "global"));
  for (const e of readDirMarkdown(path.join(homeDir, ".claude", "rules"), "rules")) push(e);

  if (projectPath && fs.existsSync(projectPath)) {
    push(readEntryIfExists(path.join(projectPath, "CLAUDE.md"), "project"));
    for (const e of readDirMarkdown(path.join(projectPath, ".claude", "rules"), "rules")) push(e);
    for (const e of readDirMarkdown(path.join(projectPath, ".claude", "memory"), "memory")) push(e);
  }

  push(
    readEntryIfExists(
      path.join(homeDir, ".claude", "projects", projectDirName, "memory", "MEMORY.md"),
      "memory",
    ),
  );

  return seed;
};

export const buildHistoryDetailFiles = (
  params: BuildHistoryDetailFilesParams,
): InjectedFile[] => {
  const { projectPath, homeDir, projectDirName, nestedMemoryPaths } = params;
  const seed = collectSeed(projectPath, homeDir, projectDirName);
  const extraRoots = deriveExtraRoots(nestedMemoryPaths ?? []);
  const merged = applyDiskScanCandidates(seed, projectPath, homeDir, extraRoots);

  // applyDiskScanCandidates uses dotClaudeScanner's category heuristic.
  // Re-classify here so categories stay consistent with the historyImporter
  // batch path (which uses the same `classifyCategory` helper inline).
  return merged.map((entry) => ({
    ...entry,
    category: classifyCategory(entry.path),
  }));
};
