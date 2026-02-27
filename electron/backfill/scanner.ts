/**
 * Backfill Scanner
 *
 * Discovers Claude session JSONL files in ~/.claude/projects/.
 * Supports mtime filtering for incremental gap-fill scans.
 */
import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import type { ScanFileEntry } from "./types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;

const getProjectsDir = (): string =>
  path.join(homedir(), ".claude", "projects");

/**
 * Find all Claude session JSONL files, optionally filtered by mtime.
 * Returns files sorted by mtime ascending (oldest first).
 */
export const findClaudeSessionFiles = (
  lastScanTimestampMs?: number | null,
): ScanFileEntry[] => {
  const projectsDir = getProjectsDir();
  if (!fs.existsSync(projectsDir)) return [];

  const results: ScanFileEntry[] = [];

  try {
    const dirs = fs.readdirSync(projectsDir).filter((f) => {
      try {
        return fs.statSync(path.join(projectsDir, f)).isDirectory();
      } catch {
        return false;
      }
    });

    for (const dir of dirs) {
      const dirPath = path.join(projectsDir, dir);
      try {
        const files = fs
          .readdirSync(dirPath)
          .filter((f) => UUID_PATTERN.test(f));

        for (const file of files) {
          const filePath = path.join(dirPath, file);
          try {
            const stat = fs.statSync(filePath);
            const mtimeMs = stat.mtimeMs;

            // Skip files older than last scan timestamp
            if (lastScanTimestampMs && mtimeMs <= lastScanTimestampMs) continue;

            results.push({
              filePath,
              sessionId: file.replace(".jsonl", ""),
              projectDir: dir,
              mtimeMs,
            });
          } catch {
            /* skip inaccessible files */
          }
        }
      } catch {
        /* skip inaccessible directories */
      }
    }
  } catch {
    /* projectsDir not readable */
  }

  // Sort oldest first for chronological processing
  results.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return results;
};

/**
 * Quick count of session files (for onboarding dialog).
 */
export const countSessionFiles = (): number => {
  const projectsDir = getProjectsDir();
  if (!fs.existsSync(projectsDir)) return 0;

  let count = 0;
  try {
    const dirs = fs.readdirSync(projectsDir).filter((f) => {
      try {
        return fs.statSync(path.join(projectsDir, f)).isDirectory();
      } catch {
        return false;
      }
    });

    for (const dir of dirs) {
      try {
        const files = fs
          .readdirSync(path.join(projectsDir, dir))
          .filter((f) => UUID_PATTERN.test(f));
        count += files.length;
      } catch {
        /* skip */
      }
    }
  } catch {
    /* skip */
  }

  return count;
};
