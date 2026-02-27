/**
 * Claude JSONL Parser
 *
 * Parses Claude Code session JSONL files and extracts token usage.
 * Supports the interactive format (type=assistant with message.usage).
 *
 * Reuses logic patterns from electron/importer/historyImporter.ts
 * but focuses on lightweight token/cost extraction for backfill.
 */
import * as fs from "fs";
import { calculateCost } from "../../utils/costCalculator";
import type { BackfillMessage } from "../types";

type RawEntry = {
  type: string;
  timestamp?: string;
  uuid?: string;
  requestId?: string;
  message?: {
    role?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    content?: string | any[];
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
};

const USER_PROMPT_LIMIT = 500;

const TOOL_SUMMARY_FIELDS = [
  "file_path",
  "pattern",
  "command",
  "query",
  "prompt",
  "url",
  "selector",
  "description",
];

/**
 * Check if a user entry has actual text content (not just tool_result blocks)
 */
const isRealUserPrompt = (entry: RawEntry): boolean => {
  if (entry.type !== "user") return false;
  const content = entry.message?.content;
  if (!content) return false;
  if (typeof content === "string") return content.trim().length > 0;
  if (Array.isArray(content)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return content.some(
      (b: Record<string, unknown>) =>
        b.type === "text" && typeof b.text === "string" && (b.text as string).trim().length > 0,
    );
  }
  return false;
};

/**
 * Extract clean user prompt text from a user entry
 */
const extractUserText = (entry: RawEntry): string => {
  const content = entry.message?.content;
  if (!content) return "";
  if (typeof content === "string") {
    return content
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
      .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "")
      .replace(/<[^>]+>/g, "")
      .trim()
      .slice(0, USER_PROMPT_LIMIT);
  }
  if (Array.isArray(content)) {
    return content
      .filter((b: Record<string, unknown>) => b.type === "text")
      .map((b: Record<string, unknown>) => (b.text as string) || "")
      .join("\n")
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
      .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "")
      .replace(/<[^>]+>/g, "")
      .trim()
      .slice(0, USER_PROMPT_LIMIT);
  }
  return "";
};

/**
 * Extract tool_summary from assistant entries in a turn range
 */
const extractToolSummary = (
  entries: RawEntry[],
  startIdx: number,
  endIdx: number,
): Record<string, number> | undefined => {
  const summary: Record<string, number> = {};
  let found = false;

  for (let i = startIdx; i < endIdx; i++) {
    const entry = entries[i];
    if (
      entry.type === "assistant" &&
      entry.message?.content &&
      Array.isArray(entry.message.content)
    ) {
      for (const block of entry.message.content) {
        if (block.type === "tool_use") {
          const name = (block.name as string) || "Unknown";
          summary[name] = (summary[name] || 0) + 1;
          found = true;
        }
      }
    }
  }

  return found ? summary : undefined;
};

/**
 * Parse a Claude session JSONL file into BackfillMessages.
 *
 * Strategy:
 * 1. Find "real user prompt" entries (user type with actual text)
 * 2. For each user prompt, find the LAST assistant entry with usage
 *    that shares the same requestId (or is the first with usage)
 * 3. Use requestId as dedup key, falling back to uuid-based key
 */
export const parseClaudeSessionFile = (
  filePath: string,
  sessionId: string,
  projectDir: string,
): BackfillMessage[] => {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const lines = content.trim().split("\n");
  const entries: RawEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      /* skip malformed lines */
    }
  }

  if (entries.length === 0) return [];

  const results: BackfillMessage[] = [];
  const seenRequestIds = new Set<string>();

  // Find all real user prompt indices
  const userPromptIndices: number[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (isRealUserPrompt(entries[i])) {
      userPromptIndices.push(i);
    }
  }

  for (let pi = 0; pi < userPromptIndices.length; pi++) {
    const userIdx = userPromptIndices[pi];
    const nextUserIdx =
      pi + 1 < userPromptIndices.length
        ? userPromptIndices[pi + 1]
        : entries.length;

    const userEntry = entries[userIdx];

    // Find the LAST assistant entry with usage in this turn range.
    // Multiple assistant entries can share the same requestId
    // (streaming chunks). We want the final one with cumulative usage.
    let bestAssistant: RawEntry | null = null;
    for (let i = userIdx + 1; i < nextUserIdx; i++) {
      if (entries[i].type === "assistant" && entries[i].message?.usage) {
        bestAssistant = entries[i];
      }
    }

    if (!bestAssistant?.message?.usage) continue;

    const usage = bestAssistant.message.usage;
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;

    // Skip entries with zero total tokens
    if (inputTokens + outputTokens + cacheRead + cacheWrite === 0) continue;

    const model = bestAssistant.message.model ?? "unknown";

    // Build dedup key: prefer requestId, fall back to uuid-based
    const requestId =
      bestAssistant.requestId ??
      userEntry.uuid ??
      `backfill-${sessionId}-${userIdx}`;

    // Skip if we already saw this requestId in this file
    if (seenRequestIds.has(requestId)) continue;
    seenRequestIds.add(requestId);

    const timestamp =
      userEntry.timestamp ?? bestAssistant.timestamp ?? new Date().toISOString();

    const cost = calculateCost(
      model,
      inputTokens,
      outputTokens,
      cacheRead,
      cacheWrite,
    );

    const userText = extractUserText(userEntry);
    const toolSummary = extractToolSummary(entries, userIdx + 1, nextUserIdx);

    results.push({
      dedupKey: requestId,
      client: "claude",
      modelId: model,
      sessionId,
      projectPath: projectDir,
      timestamp,
      tokens: {
        input: inputTokens,
        output: outputTokens,
        cacheRead,
        cacheWrite,
      },
      costUsd: cost,
      userPrompt: userText || undefined,
      toolSummary,
    });
  }

  return results;
};
