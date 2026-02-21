import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import { UsageLogEntry } from "./types";

const USAGE_DIR = path.join(homedir(), ".claude", "context-state");
const USAGE_FILE = "api-usage.jsonl";

export const getUsageFilePath = (): string => path.join(USAGE_DIR, USAGE_FILE);

export const writeUsageLog = (entry: UsageLogEntry): void => {
  try {
    if (!fs.existsSync(USAGE_DIR)) {
      fs.mkdirSync(USAGE_DIR, { recursive: true });
    }

    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(getUsageFilePath(), line, "utf-8");
  } catch (error) {
    console.error("Failed to write usage log:", error);
  }
};

/** @deprecated Use dbReader.getPromptDetail() instead. Kept as JSONL fallback. */
export const readUsageLog = (): UsageLogEntry[] => {
  const filePath = getUsageFilePath();

  if (!fs.existsSync(filePath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return content
      .trim()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as UsageLogEntry);
  } catch (error) {
    console.error("Failed to read usage log:", error);
    return [];
  }
};
