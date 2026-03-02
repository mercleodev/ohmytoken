/**
 * Codex Session Scanner
 *
 * Discovers Codex session JSONL files in ~/.codex/sessions/.
 * Files follow the pattern: YYYY/MM/DD/rollout-{date}T{time}-{uuid}.jsonl
 * Extracts session ID (uuid portion) and project dir from session_meta event.
 */
import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import type { ScanFileEntry } from "./types";

const ROLLOUT_PATTERN = /^rollout-.*\.jsonl$/;

const getCodexSessionsDir = (): string =>
  path.join(homedir(), ".codex", "sessions");

/**
 * Extract session ID from Codex filename.
 * Format: rollout-YYYY-MM-DDTHH-MM-SS-{uuid}.jsonl
 * The uuid portion is the last 36 characters before .jsonl
 */
const extractSessionId = (filename: string): string => {
  // Remove "rollout-" prefix and ".jsonl" suffix
  const stem = filename.replace(/^rollout-/, "").replace(/\.jsonl$/, "");
  // UUID is the last 36 chars (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
  const uuidMatch = stem.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/,
  );
  return uuidMatch ? uuidMatch[1] : stem;
};

/**
 * Extract project directory (cwd) from the first session_meta event.
 */
const extractProjectDir = (filePath: string): string => {
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(4096);
    const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);

    const firstLine = buf.subarray(0, bytesRead).toString("utf-8").split("\n")[0];
    const obj = JSON.parse(firstLine);
    if (obj.type === "session_meta" && obj.payload?.cwd) {
      return obj.payload.cwd;
    }
  } catch {
    /* ignore parse errors */
  }
  return "";
};

/**
 * Recursively walk a directory and collect files matching a predicate.
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
 * Find all Codex session JSONL files, optionally filtered by mtime.
 * Returns files sorted by mtime ascending (oldest first).
 */
export const findCodexSessionFiles = (
  lastScanTimestampMs?: number | null,
): ScanFileEntry[] => {
  const sessionsDir = getCodexSessionsDir();
  if (!fs.existsSync(sessionsDir)) return [];

  const results: ScanFileEntry[] = [];
  const allFiles = walkDir(sessionsDir, (name) => ROLLOUT_PATTERN.test(name));

  for (const filePath of allFiles) {
    try {
      const stat = fs.statSync(filePath);
      const mtimeMs = stat.mtimeMs;

      if (lastScanTimestampMs && mtimeMs <= lastScanTimestampMs) continue;

      const filename = path.basename(filePath);
      results.push({
        filePath,
        sessionId: extractSessionId(filename),
        projectDir: extractProjectDir(filePath),
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
 * Build a ScanFileEntry from a single file path.
 * Used by the real-time watcher to bypass mtime-based scanning.
 */
export const buildScanEntry = (filePath: string): ScanFileEntry | null => {
  try {
    const stat = fs.statSync(filePath);
    const filename = path.basename(filePath);
    return {
      filePath,
      sessionId: extractSessionId(filename),
      projectDir: extractProjectDir(filePath),
      mtimeMs: stat.mtimeMs,
    };
  } catch {
    return null;
  }
};

/**
 * Quick count of Codex session files.
 */
export const countCodexSessionFiles = (): number => {
  const sessionsDir = getCodexSessionsDir();
  if (!fs.existsSync(sessionsDir)) return 0;

  return walkDir(sessionsDir, (name) => ROLLOUT_PATTERN.test(name)).length;
};
