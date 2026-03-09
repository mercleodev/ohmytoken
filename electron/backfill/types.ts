/**
 * Backfill Types
 *
 * Shared type definitions for the backfill system that imports
 * past token usage from provider session files.
 */

export type BackfillClient = "claude" | "codex" | "gemini";

export type BackfillToolCall = {
  name: string;
  inputSummary?: string;
  timestamp?: string;
};

export type BackfillMessage = {
  dedupKey: string;
  client: BackfillClient;
  modelId: string;
  sessionId: string;
  projectPath: string;
  timestamp: string; // ISO 8601
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  /** Explicit context window fill (e.g. from last_token_usage.input_tokens).
   *  When set, writer uses this instead of input+cacheRead+cacheWrite. */
  totalContextTokens?: number;
  costUsd: number;
  userPrompt?: string; // 500 char limit
  toolSummary?: Record<string, number>;
  toolCalls?: BackfillToolCall[];
  assistantResponse?: string;
  conversationTurns?: number;
  userMessagesCount?: number;
  assistantMessagesCount?: number;
};

export type BackfillProgress = {
  phase: "scanning" | "parsing" | "writing" | "done";
  totalFiles: number;
  processedFiles: number;
  discoveredMessages: number;
  insertedMessages: number;
  skippedDuplicates: number;
  errors: number;
};

export type BackfillResult = {
  totalFiles: number;
  processedFiles: number;
  insertedMessages: number;
  skippedDuplicates: number;
  errors: number;
  totalCostUsd: number;
  dateRange: { earliest: string; latest: string } | null;
  durationMs: number;
};

export type ScanFileEntry = {
  filePath: string;
  sessionId: string;
  projectDir: string;
  mtimeMs: number;
};
