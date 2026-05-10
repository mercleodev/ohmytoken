import fs from "node:fs";

export type TranscriptSettleOptions = {
  /** Polling interval between size probes. */
  intervalMs?: number;
  /** File size must be unchanged for this many ms before we declare stable. */
  stableForMs?: number;
  /** Hard ceiling on total time spent waiting. */
  maxWaitMs?: number;
};

export type TranscriptSettleResult = {
  /** true when the file size held steady for `stableForMs` before the timeout. */
  stable: boolean;
  finalSize: number;
  waitedMs: number;
};

const probeSize = (filePath: string): number => {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return -1;
  }
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Waits until the transcript file size has been unchanged for at least
 * `stableForMs`, or until `maxWaitMs` elapses. Resolves immediately if
 * the file does not exist (nothing to read anyway).
 *
 * Issue #349: Claude Code's Stop hook fires before the runner flushes
 * the final assistant message + nested_memory attachments for the cycle.
 * A simple "two equal probes" check is fooled by writer-side pauses
 * between flushes, so we require the size to hold steady for a window.
 */
export const waitForTranscriptSettle = async (
  filePath: string,
  options: TranscriptSettleOptions = {},
): Promise<TranscriptSettleResult> => {
  const intervalMs = options.intervalMs ?? 100;
  const stableForMs = options.stableForMs ?? 300;
  const maxWaitMs = options.maxWaitMs ?? 3000;
  const start = Date.now();

  let lastSize = probeSize(filePath);
  if (lastSize < 0) {
    return { stable: true, finalSize: 0, waitedMs: Date.now() - start };
  }
  let lastChangeAt = start;

  while (true) {
    await sleep(intervalMs);
    const now = Date.now();
    const current = probeSize(filePath);

    if (current < 0) {
      return { stable: true, finalSize: lastSize, waitedMs: now - start };
    }
    if (current !== lastSize) {
      lastSize = current;
      lastChangeAt = now;
    }
    if (now - lastChangeAt >= stableForMs) {
      return { stable: true, finalSize: current, waitedMs: now - start };
    }
    if (now - start >= maxWaitMs) {
      return { stable: false, finalSize: current, waitedMs: now - start };
    }
  }
};

export type TranscriptUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

export type TranscriptNestedMemory = {
  path: string;
  type: string;
  content: string;
};

export type TranscriptTurn = {
  session_id: string | undefined;
  cwd: string | undefined;
  git_branch: string | undefined;
  request_id: string | undefined;

  user_message_text: string;
  assistant_message_text: string;
  model: string;
  usage: TranscriptUsage;

  nested_memories: TranscriptNestedMemory[];

  assistant_uuid: string;
  assistant_timestamp: string;
};

type JsonlLine = {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  requestId?: string;
  timestamp?: string;
  message?: {
    role?: string;
    model?: string;
    content?: unknown;
    usage?: Partial<TranscriptUsage> & Record<string, unknown>;
  };
  attachment?: {
    type?: string;
    path?: string;
    content?: { path?: string; type?: string; content?: string } | unknown;
  };
};

const readLines = (filePath: string): JsonlLine[] => {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }
  const lines: JsonlLine[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      lines.push(JSON.parse(trimmed));
    } catch {
      continue;
    }
  }
  return lines;
};

const extractText = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (b && typeof b === "object" && (b as { type?: string }).type === "text") {
          return String((b as { text?: string }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
};

export const readLatestTurn = (transcriptPath: string): TranscriptTurn | null => {
  const lines = readLines(transcriptPath);
  if (lines.length === 0) return null;

  let assistantIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].type === "assistant") {
      assistantIdx = i;
      break;
    }
  }
  if (assistantIdx === -1) return null;
  const assistant = lines[assistantIdx];
  if (!assistant.message || !assistant.uuid) return null;

  const byUuid = new Map<string, JsonlLine>();
  for (const l of lines) {
    if (l.uuid) byUuid.set(l.uuid, l);
  }

  const ancestry: JsonlLine[] = [];
  let cursor: string | null | undefined = assistant.parentUuid ?? null;
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const node = byUuid.get(cursor);
    if (!node) break;
    ancestry.push(node);
    cursor = node.parentUuid ?? null;
  }

  let userMessageText = "";
  for (const node of ancestry) {
    if (node.type === "user" && node.message) {
      userMessageText = extractText(node.message.content);
      if (userMessageText) break;
    }
  }

  const nestedMemories: TranscriptNestedMemory[] = [];
  const seenPaths = new Set<string>();
  for (const node of ancestry) {
    if (node.type !== "attachment" || !node.attachment) continue;
    if (node.attachment.type !== "nested_memory") continue;
    const inner = node.attachment.content as
      | { path?: string; type?: string; content?: string }
      | undefined;
    const p = inner?.path ?? node.attachment.path;
    if (!p || seenPaths.has(p)) continue;
    seenPaths.add(p);
    nestedMemories.push({
      path: p,
      type: inner?.type ?? "Unknown",
      content: inner?.content ?? "",
    });
  }

  const usageRaw = assistant.message.usage ?? {};
  const usage: TranscriptUsage = {
    input_tokens: Number(usageRaw.input_tokens ?? 0) || 0,
    output_tokens: Number(usageRaw.output_tokens ?? 0) || 0,
    cache_creation_input_tokens: Number(usageRaw.cache_creation_input_tokens ?? 0) || 0,
    cache_read_input_tokens: Number(usageRaw.cache_read_input_tokens ?? 0) || 0,
  };

  return {
    session_id: assistant.sessionId,
    cwd: assistant.cwd,
    git_branch: assistant.gitBranch,
    request_id: assistant.requestId,

    user_message_text: userMessageText,
    assistant_message_text: extractText(assistant.message.content),
    model: assistant.message.model ?? "unknown",
    usage,

    nested_memories: nestedMemories,

    assistant_uuid: assistant.uuid,
    assistant_timestamp: assistant.timestamp ?? "",
  };
};
