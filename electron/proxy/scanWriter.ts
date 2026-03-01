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
