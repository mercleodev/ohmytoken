/**
 * Backfill Scanner
 *
 * Discovers Claude session JSONL files in ~/.claude/projects/.
 * Recursively walks all subdirectories (like tokscale's walkdir approach).
 * Supports mtime filtering for incremental gap-fill scans.
 */
import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import type { ScanFileEntry } from "./types";

const UUID_JSONL_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;

const getProjectsDir = (): string =>
  path.join(homedir(), ".claude", "projects");

/**
 * Recursively walk a directory and collect all files matching a predicate.
 */
const walkDir = (
  dir: string,
  predicate: (filename: string) => boolean,
): string[] => {
  const results: string[] = [];

  const walk = (currentDir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && predicate(entry.name)) {
        results.push(fullPath);
      }
    }
  };

  walk(dir);
  return results;
};

/**
 * Extract projectDir (first-level dir under projects/) from a full file path.
 */
const extractProjectDir = (filePath: string, projectsDir: string): string => {
  const relative = path.relative(projectsDir, filePath);
  const parts = relative.split(path.sep);
  return parts[0] || "";
};

/**
 * Find all Claude session JSONL files, optionally filtered by mtime.
 * Recursively walks all subdirectories under ~/.claude/projects/.
 * Returns files sorted by mtime ascending (oldest first).
 */
export const findClaudeSessionFiles = (
  lastScanTimestampMs?: number | null,
): ScanFileEntry[] => {
  const projectsDir = getProjectsDir();
  if (!fs.existsSync(projectsDir)) return [];

  const results: ScanFileEntry[] = [];

  const allFiles = walkDir(projectsDir, (name) =>
    UUID_JSONL_PATTERN.test(name),
  );

  for (const filePath of allFiles) {
    try {
      const stat = fs.statSync(filePath);
      const mtimeMs = stat.mtimeMs;

      if (lastScanTimestampMs && mtimeMs <= lastScanTimestampMs) continue;

      const filename = path.basename(filePath);
      results.push({
        filePath,
        sessionId: filename.replace(".jsonl", ""),
        projectDir: extractProjectDir(filePath, projectsDir),
        mtimeMs,
      });
    } catch {
      /* skip inaccessible files */
    }
  }

  results.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return results;
};

/**
 * Quick count of session files (for onboarding dialog).
 * Recursively walks all subdirectories.
 */
export const countSessionFiles = (): number => {
  const projectsDir = getProjectsDir();
  if (!fs.existsSync(projectsDir)) return 0;

  return walkDir(projectsDir, (name) => UUID_JSONL_PATTERN.test(name)).length;
};
