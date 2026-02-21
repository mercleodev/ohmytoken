import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import { PromptScan } from "./types";

const SCAN_DIR = path.join(homedir(), ".claude", "context-state");
const SCAN_FILE = "prompt-scans.jsonl";
const MAX_ENTRIES = 1000;
const PRUNE_TO = 500;

export const getScanFilePath = (): string => path.join(SCAN_DIR, SCAN_FILE);

export const writeScanLog = (entry: PromptScan): void => {
  try {
    if (!fs.existsSync(SCAN_DIR)) {
      fs.mkdirSync(SCAN_DIR, { recursive: true });
    }

    const filePath = getScanFilePath();
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(filePath, line, "utf-8");

    // Size management
    pruneIfNeeded(filePath);
  } catch (error) {
    console.error("Failed to write scan log:", error);
  }
};

const pruneIfNeeded = (filePath: string): void => {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content
      .trim()
      .split("\n")
      .filter((l) => l.trim());

    if (lines.length > MAX_ENTRIES) {
      // Delete older half of entries
      const kept = lines.slice(lines.length - PRUNE_TO);
      fs.writeFileSync(filePath, kept.join("\n") + "\n", "utf-8");
    }
  } catch {
    // Ignore pruning failures
  }
};

/** @deprecated Use dbReader.getPrompts() instead. Kept as JSONL fallback. */
export const readScanLog = (): PromptScan[] => {
  const filePath = getScanFilePath();

  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return content
      .trim()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as PromptScan);
  } catch (error) {
    console.error("Failed to read scan log:", error);
    return [];
  }
};

/** @deprecated Use dbReader.getPrompts(options) instead. Kept as JSONL fallback. */
export const readScanLogFiltered = (options?: {
  limit?: number;
  offset?: number;
  session_id?: string;
}): PromptScan[] => {
  let scans = readScanLog();

  if (options?.session_id) {
    scans = scans.filter((s) => s.session_id === options.session_id);
  }

  // Sort by newest first
  scans.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  const offset = options?.offset ?? 0;
  const limit = options?.limit ?? 50;

  return scans.slice(offset, offset + limit);
};

/** @deprecated Use dbReader.getPromptDetail(requestId) instead. Kept as JSONL fallback. */
export const readScanByRequestId = (requestId: string): PromptScan | null => {
  const scans = readScanLog();
  return scans.find((s) => s.request_id === requestId) ?? null;
};

/**
 * Find a proxy scan matching a history timestamp (within toleranceMs).
 * Returns the closest scan if found, null otherwise.
 * @deprecated Use dbReader.findPromptByTimestamp() instead. Kept as JSONL fallback.
 */
export const findScanByTimestamp = (
  timestampMs: number,
  toleranceMs = 30000,
): PromptScan | null => {
  const scans = readScanLog();
  let best: PromptScan | null = null;
  let bestDiff = Infinity;
  for (const s of scans) {
    const scanTime = new Date(s.timestamp).getTime();
    const diff = Math.abs(scanTime - timestampMs);
    if (diff < bestDiff && diff <= toleranceMs) {
      bestDiff = diff;
      best = s;
    }
  }
  return best;
};
