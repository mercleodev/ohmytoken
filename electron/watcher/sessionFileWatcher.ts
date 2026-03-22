/**
 * Session File Watcher
 *
 * Watches the active Claude session JSONL file for real-time changes.
 * Detects HumanTurn (user prompt sent) and AssistantTurn (response complete)
 * to enable live "Processing..." → "Completed" notification flow.
 *
 * Uses fs.watch + fast polling fallback for reliable sub-second detection.
 */
import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";

export type SessionTurnEvent = {
  type: "human" | "assistant";
  sessionId: string;
  userPrompt?: string;
  timestamp: string;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
};

export type SessionActivityEvent = {
  sessionId: string;
  timestamp: string;
  kind: "tool_use" | "tool_result" | "text" | "thinking";
  name: string; // tool name or "response"
  detail: string; // file path, search query, or text snippet
};

type SessionFileWatcherOptions = {
  onTurn: (event: SessionTurnEvent) => void;
  onActivity?: (event: SessionActivityEvent) => void;
};

const PROJECTS_DIR = path.join(homedir(), ".claude", "projects");
const POLL_INTERVAL_MS = 500;

/** System/internal messages to ignore */
const SYSTEM_PATTERNS = [
  "Compacted (ctrl+o to see full summary)",
  "This session is being continued from a previous conversation",
  "Read the output file to retrieve the result:",
  "Background command",
  "IMPORTANT: After completing your current task",
  "The user sent a new message while you were working",
];

const stripAnsi = (text: string): string =>
  text.replace(/\x1b\[[0-9;]*m/g, "").replace(/\[[\d;]*m/g, "");

const isSystemMessage = (text: string): boolean => {
  const clean = stripAnsi(text).trim();
  return SYSTEM_PATTERNS.some((p) => clean.includes(p));
};

const extractUserText = (content: string | unknown[]): string => {
  if (typeof content === "string") return cleanPromptText(content);
  if (Array.isArray(content)) {
    const hasToolResult = content.some(
      (b: any) => b.type === "tool_result",
    );
    if (hasToolResult) return "";
    return cleanPromptText(
      content
        .filter((b: any) => b.type === "text" && typeof b.text === "string")
        .map((b: any) => b.text)
        .join("\n"),
    );
  }
  return "";
};

const cleanPromptText = (raw: string): string =>
  stripAnsi(raw)
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "")
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/g, "")
    .replace(/<command-name>[\s\S]*?<\/command-name>/g, "")
    .replace(/<command-message>[\s\S]*?<\/command-message>/g, "")
    .replace(/<command-args>[\s\S]*?<\/command-args>/g, "")
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, "")
    .replace(/<available-deferred-tools>[\s\S]*?<\/available-deferred-tools>/g, "")
    .replace(/<user-prompt-submit-hook>[\s\S]*?<\/user-prompt-submit-hook>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/Read the output file to retrieve the result:[^\n]*/g, "")
    .replace(/IMPORTANT: After completing your current task[^\n]*/g, "")
    .replace(/The user sent a new message while you were working:[^\n]*/g, "")
    .replace(/Background command "[^"]*" (?:failed|completed)[^\n]*/g, "")
    .trim();

/** Extract a concise detail string from a tool_use input */
const extractToolDetail = (toolName: string, input: any): string => {
  if (!input) return "";
  try {
    switch (toolName) {
      case "Read":
        return input.file_path ?? input.path ?? "";
      case "Write":
        return input.file_path ?? input.path ?? "";
      case "Edit":
        return input.file_path ?? input.path ?? "";
      case "Grep":
        return `${input.pattern ?? ""} ${input.path ?? ""}`.trim();
      case "Glob":
        return input.pattern ?? "";
      case "Bash":
        return (input.command ?? "").slice(0, 60);
      case "Agent":
        return input.description ?? input.prompt?.slice(0, 60) ?? "";
      case "WebSearch":
        return input.query ?? "";
      case "WebFetch":
        return input.url ?? "";
      default:
        // Generic: try common field names
        return (
          input.file_path ?? input.path ?? input.command ?? input.query ?? input.pattern ??
          (typeof input === "string" ? input.slice(0, 60) : "")
        );
    }
  } catch {
    return "";
  }
};

/**
 * Find the session JSONL file path for a given sessionId.
 */
export const findSessionFilePath = (sessionId: string): string | null => {
  if (!fs.existsSync(PROJECTS_DIR)) return null;
  try {
    const dirs = fs.readdirSync(PROJECTS_DIR).filter((f) => {
      try {
        return fs.statSync(path.join(PROJECTS_DIR, f)).isDirectory();
      } catch {
        return false;
      }
    });
    for (const dir of dirs) {
      const candidate = path.join(PROJECTS_DIR, dir, `${sessionId}.jsonl`);
      if (fs.existsSync(candidate)) return candidate;
    }
  } catch {
    // ignore
  }
  return null;
};

/**
 * Find the most recently modified session JSONL file across all projects.
 * Used for auto-detecting the active session without waiting for history.jsonl.
 */
const findMostRecentSessionFile = (): { sessionId: string; filePath: string } | null => {
  if (!fs.existsSync(PROJECTS_DIR)) return null;
  try {
    const dirs = fs.readdirSync(PROJECTS_DIR).filter((f) => {
      try {
        return fs.statSync(path.join(PROJECTS_DIR, f)).isDirectory();
      } catch {
        return false;
      }
    });

    let best: { sessionId: string; filePath: string; mtime: number } | null = null;
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jsonl$/;

    for (const dir of dirs) {
      const dirPath = path.join(PROJECTS_DIR, dir);
      try {
        const files = fs.readdirSync(dirPath).filter((f) => UUID_RE.test(f));
        for (const file of files) {
          const filePath = path.join(dirPath, file);
          try {
            const stat = fs.statSync(filePath);
            if (!best || stat.mtimeMs > best.mtime) {
              best = {
                sessionId: file.replace(".jsonl", ""),
                filePath,
                mtime: stat.mtimeMs,
              };
            }
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }

    return best ? { sessionId: best.sessionId, filePath: best.filePath } : null;
  } catch {
    return null;
  }
};

/**
 * Watches a specific session JSONL file for new entries.
 * Uses fs.watch + polling for reliable fast detection.
 */
export const startSessionFileWatcher = (
  options: SessionFileWatcherOptions,
): {
  cleanup: () => void;
  switchSession: (sessionId: string) => void;
} => {
  let currentWatcher: fs.FSWatcher | null = null;
  let currentSessionId: string | null = null;
  let currentFilePath: string | null = null;
  let lastSize = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  const processNewData = (filePath: string, sessionId: string) => {
    try {
      if (!fs.existsSync(filePath)) return;
      const stat = fs.statSync(filePath);
      if (stat.size <= lastSize) {
        if (stat.size < lastSize) lastSize = stat.size; // truncated
        return;
      }

      const fd = fs.openSync(filePath, "r");
      const newBytes = stat.size - lastSize;
      const buffer = Buffer.alloc(newBytes);
      fs.readSync(fd, buffer, 0, newBytes, lastSize);
      fs.closeSync(fd);
      lastSize = stat.size;

      const newContent = buffer.toString("utf-8");
      const lines = newContent.trim().split("\n").filter((l) => l.trim());

      for (const line of lines) {
        try {
          const raw = JSON.parse(line);
          if (!raw.type) continue;

          if (raw.type === "user" && raw.message?.content) {
            const text = extractUserText(raw.message.content);
            if (text && !isSystemMessage(text)) {
              options.onTurn({
                type: "human",
                sessionId,
                userPrompt: text,
                timestamp: raw.timestamp || new Date().toISOString(),
                model: raw.message?.model,
              });
            }
          } else if (raw.type === "assistant" && raw.message) {
            // Check if this assistant message has tool_use (still working)
            const hasToolUse = Array.isArray(raw.message.content) &&
              raw.message.content.some((b: any) => b.type === "tool_use");

            // Only emit AssistantTurn (complete) when there are NO tool_use blocks
            // (meaning this is the final text response, not a mid-turn tool call)
            if (!hasToolUse) {
              options.onTurn({
                type: "assistant",
                sessionId,
                timestamp: raw.timestamp || new Date().toISOString(),
                model: raw.message?.model,
                usage: raw.message?.usage,
              });
            }

            // Extract tool_use activity from assistant message content
            if (options.onActivity && Array.isArray(raw.message.content)) {
              const ts = raw.timestamp || new Date().toISOString();
              for (const block of raw.message.content) {
                if (block.type === "tool_use" && block.name) {
                  const detail = extractToolDetail(block.name, block.input);
                  options.onActivity({
                    sessionId,
                    timestamp: ts,
                    kind: "tool_use",
                    name: block.name,
                    detail,
                  });
                } else if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
                  // Text snippet from assistant response (longer for Response section display)
                  const cleaned = block.text.trim();
                  if (cleaned.length >= 5) {
                    options.onActivity({
                      sessionId,
                      timestamp: ts,
                      kind: "text",
                      name: "response",
                      detail: cleaned.slice(0, 200),
                    });
                  }
                } else if (block.type === "thinking" && typeof block.thinking === "string") {
                  const snippet = block.thinking.trim().slice(0, 80);
                  if (snippet) {
                    options.onActivity({
                      sessionId,
                      timestamp: ts,
                      kind: "thinking",
                      name: "thinking",
                      detail: snippet,
                    });
                  }
                }
              }
            }
          }
        } catch {
          // skip malformed lines
        }
      }
    } catch (err) {
      console.error("[SessionFileWatcher] Error reading new data:", err);
    }
  };

  const startWatching = (filePath: string, sessionId: string, catchUp = false) => {
    // Set initial size — optionally rewind to catch recent entries on session switch
    try {
      const fileSize = fs.statSync(filePath).size;
      if (catchUp && fileSize > 0) {
        // Rewind up to 8KB to catch the most recent user message
        const REWIND_BYTES = 8192;
        lastSize = Math.max(0, fileSize - REWIND_BYTES);
        // Process the rewound chunk immediately
        processNewData(filePath, sessionId);
      } else {
        lastSize = fileSize;
      }
    } catch {
      lastSize = 0;
    }

    const dir = path.dirname(filePath);
    const filename = path.basename(filePath);

    // fs.watch for instant notification (when it works)
    try {
      currentWatcher = fs.watch(dir, (_, changedFile) => {
        if (changedFile !== filename) return;
        processNewData(filePath, sessionId);
      });
    } catch (err) {
      console.error("[SessionFileWatcher] fs.watch failed:", err);
    }

    // Polling fallback: check every 500ms for changes fs.watch might miss
    pollTimer = setInterval(() => {
      processNewData(filePath, sessionId);
    }, POLL_INTERVAL_MS);

    console.log(`[SessionFileWatcher] Watching session: ${sessionId}`);
  };

  const stopWatching = () => {
    if (currentWatcher) {
      currentWatcher.close();
      currentWatcher = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const switchSession = (sessionId: string) => {
    if (sessionId === currentSessionId) return;

    const filePath = findSessionFilePath(sessionId);
    if (!filePath) {
      console.log(`[SessionFileWatcher] Session file not found: ${sessionId}`);
      return;
    }

    stopWatching();
    currentSessionId = sessionId;
    currentFilePath = filePath;
    startWatching(filePath, sessionId, true);
  };

  // Auto-detect: find the most recently modified session file
  const mostRecent = findMostRecentSessionFile();
  if (mostRecent) {
    currentSessionId = mostRecent.sessionId;
    currentFilePath = mostRecent.filePath;
    startWatching(mostRecent.filePath, mostRecent.sessionId);
  }

  const cleanup = () => {
    stopWatching();
    console.log("[SessionFileWatcher] Watcher closed");
  };

  return { cleanup, switchSession };
};
