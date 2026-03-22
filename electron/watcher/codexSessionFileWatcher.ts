/**
 * Codex Session File Watcher
 *
 * Watches the active Codex session JSONL file for real-time changes.
 * Detects HumanTurn (user_message), AssistantTurn (token_count), and
 * activity events (function_call, agent_message) to enable live
 * "Processing..." → "Completed" notification flow — identical to
 * the Claude sessionFileWatcher.
 *
 * Uses ~/.codex/history.jsonl as a trigger to discover the active session,
 * then watches the session file with fs.watch + polling for sub-second detection.
 *
 * Emits the same SessionTurnEvent / SessionActivityEvent types as the
 * Claude watcher so the React notification layer needs zero changes.
 */
import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import type { SessionTurnEvent, SessionActivityEvent } from "./sessionFileWatcher";
import { findSessionFileBySessionId, findCodexSessionFiles } from "../backfill/codex-scanner";

// ── Constants ──────────────────────────────────────────────────────

const CODEX_HISTORY_PATH = path.join(homedir(), ".codex", "history.jsonl");
const POLL_INTERVAL_MS = 500;
/** Debounce for token_count → AssistantTurn (handles duplicate pairs) */
const TOKEN_COUNT_DEBOUNCE_MS = 300;

const USER_PROMPT_LIMIT = 500;
const ACTIVITY_DETAIL_LIMIT = 200;
const RESPONSE_DETAIL_LIMIT = 200;

// ── Types ──────────────────────────────────────────────────────────

type CodexSessionFileWatcherOptions = {
  onTurn: (event: SessionTurnEvent) => void;
  onActivity?: (event: SessionActivityEvent) => void;
};

type CodexRawEvent = {
  timestamp?: string;
  type: string;
  payload: {
    type?: string;
    id?: string;
    cwd?: string;
    model_provider?: string;
    message?: string;
    phase?: string;
    model?: string;
    name?: string;
    arguments?: string;
    input?: string;
    info?: {
      total_token_usage?: {
        input_tokens: number;
        cached_input_tokens: number;
        output_tokens: number;
        reasoning_output_tokens: number;
        total_tokens: number;
      };
      last_token_usage?: { input_tokens?: number };
      model_context_window?: number;
    } | null;
    model_context_window?: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    content?: any[];
  };
};

// ── Helpers ─────────────────────────────────────────────────────────

/** Infer model name from context window size (fallback). */
const inferModelFromContextWindow = (ctxWindow: number): string => {
  if (ctxWindow <= 200_000) return "o4-mini";
  return "o3";
};

/** Extract tool detail for activity events. */
const extractCodexToolDetail = (name: string, args: string | undefined): string => {
  if (!args) return "";
  if (name === "exec_command") {
    try {
      const parsed = JSON.parse(args);
      return (parsed.cmd ?? args).slice(0, ACTIVITY_DETAIL_LIMIT);
    } catch { /* use raw */ }
  }
  return args.slice(0, ACTIVITY_DETAIL_LIMIT);
};

/** Read the last line of history.jsonl to get the latest session_id. */
const readLastSessionIdFromHistory = (): string | null => {
  try {
    const stat = fs.statSync(CODEX_HISTORY_PATH);
    const readSize = Math.min(4096, stat.size);
    const fd = fs.openSync(CODEX_HISTORY_PATH, "r");
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);

    const text = buf.toString("utf-8");
    const lines = text.trim().split("\n");
    const lastLine = lines[lines.length - 1];
    const obj = JSON.parse(lastLine);
    return obj.session_id ?? null;
  } catch {
    return null;
  }
};

/** Find the most recently modified Codex session file. */
const findMostRecentCodexSession = (): { sessionId: string; filePath: string } | null => {
  try {
    const files = findCodexSessionFiles(null);
    if (files.length === 0) return null;
    const latest = files[files.length - 1]; // sorted by mtime asc
    return { sessionId: latest.sessionId, filePath: latest.filePath };
  } catch {
    return null;
  }
};

// ── Main Watcher ────────────────────────────────────────────────────

/**
 * Start watching Codex session files for real-time notification events.
 *
 * Detection flow:
 * 1. On startup: find most recently modified session file → watch it
 * 2. On history.jsonl change: switch to the new session file
 * 3. Parse JSONL events incrementally → emit turn/activity events
 *
 * Turn detection state machine:
 *   IDLE → event_msg(user_message) → IN_TURN
 *   IN_TURN → response_item / agent_message → onActivity
 *   IN_TURN → event_msg(token_count) → onTurn("assistant") → IDLE
 */
export const startCodexSessionFileWatcher = (
  options: CodexSessionFileWatcherOptions,
): {
  cleanup: () => void;
} => {
  // ── State ──
  let currentSessionId: string | null = null;
  let lastSize = 0;

  // Session-level cached metadata
  let cachedModel: string | null = null;
  let cachedCwd: string | null = null;

  // Turn state machine
  let inTurn = false;
  let currentTurnTimestamp: string | null = null;

  // token_count debounce (handles duplicate pairs)
  let tokenCountTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingTokenCountEvent: CodexRawEvent | null = null;

  // Watchers
  let sessionWatcher: fs.FSWatcher | null = null;
  let historyWatcher: fs.FSWatcher | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // ── Event Processing ──

  const emitAssistantTurn = () => {
    if (!currentSessionId || !pendingTokenCountEvent) return;

    const ts = pendingTokenCountEvent.timestamp ?? new Date().toISOString();
    const usage = pendingTokenCountEvent.payload?.info?.total_token_usage;

    options.onTurn({
      type: "assistant",
      sessionId: currentSessionId,
      timestamp: ts,
      model: cachedModel ?? undefined,
      usage: usage ? {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_read_input_tokens: usage.cached_input_tokens,
        cache_creation_input_tokens: 0,
      } : undefined,
    });

    inTurn = false;
    pendingTokenCountEvent = null;
    currentTurnTimestamp = null;
  };

  const processEvent = (ev: CodexRawEvent) => {
    if (!currentSessionId) return;
    const sessionId = currentSessionId;

    // ── session_meta: cache cwd ──
    if (ev.type === "session_meta" && ev.payload?.cwd) {
      cachedCwd = ev.payload.cwd;
      return;
    }

    // ── turn_context: cache model ──
    if (ev.type === "turn_context" && ev.payload?.model) {
      cachedModel = ev.payload.model;
      return;
    }

    // ── Infer model from context window (fallback) ──
    if (ev.type === "event_msg" && !cachedModel) {
      const ctxWindow = ev.payload?.model_context_window ?? ev.payload?.info?.model_context_window;
      if (ctxWindow) {
        cachedModel = inferModelFromContextWindow(ctxWindow);
      }
    }

    // ── event_msg(user_message) → HumanTurn ──
    if (ev.type === "event_msg" && ev.payload?.type === "user_message") {
      // If previous turn wasn't closed by token_count, force-close it
      if (inTurn && tokenCountTimer) {
        clearTimeout(tokenCountTimer);
        tokenCountTimer = null;
        emitAssistantTurn();
      }

      const message = ev.payload.message ?? "";
      const trimmed = message.trim().slice(0, USER_PROMPT_LIMIT);

      if (trimmed) {
        inTurn = true;
        currentTurnTimestamp = ev.timestamp ?? new Date().toISOString();

        options.onTurn({
          type: "human",
          sessionId,
          userPrompt: trimmed,
          timestamp: currentTurnTimestamp,
          model: cachedModel ?? undefined,
        });
      }
      return;
    }

    // ── response_item(function_call / custom_tool_call) → Activity ──
    if (
      ev.type === "response_item" &&
      (ev.payload?.type === "function_call" || ev.payload?.type === "custom_tool_call") &&
      ev.payload.name
    ) {
      options.onActivity?.({
        sessionId,
        timestamp: ev.timestamp ?? new Date().toISOString(),
        kind: "tool_use",
        name: ev.payload.name,
        detail: extractCodexToolDetail(ev.payload.name, ev.payload.arguments ?? ev.payload.input),
      });
      return;
    }

    // ── event_msg(agent_message) → Activity (text) ──
    if (ev.type === "event_msg" && ev.payload?.type === "agent_message" && ev.payload.message) {
      const text = ev.payload.message.trim();
      if (text.length >= 5) {
        options.onActivity?.({
          sessionId,
          timestamp: ev.timestamp ?? new Date().toISOString(),
          kind: "text",
          name: "response",
          detail: text.slice(0, RESPONSE_DETAIL_LIMIT),
        });
      }
      return;
    }

    // ── event_msg(token_count) → AssistantTurn (debounced) ──
    if (ev.type === "event_msg" && ev.payload?.type === "token_count" && inTurn) {
      pendingTokenCountEvent = ev;
      if (tokenCountTimer) clearTimeout(tokenCountTimer);
      tokenCountTimer = setTimeout(() => {
        tokenCountTimer = null;
        emitAssistantTurn();
      }, TOKEN_COUNT_DEBOUNCE_MS);
      return;
    }
  };

  // ── Incremental File Reader ──

  const processNewData = (filePath: string) => {
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
          const ev: CodexRawEvent = JSON.parse(line);
          if (ev.type) processEvent(ev);
        } catch {
          // skip malformed lines
        }
      }
    } catch (err) {
      console.error("[CodexSessionWatcher] Error reading new data:", err);
    }
  };

  // ── Session File Watch Management ──

  const stopSessionWatch = () => {
    if (sessionWatcher) {
      sessionWatcher.close();
      sessionWatcher = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (tokenCountTimer) {
      clearTimeout(tokenCountTimer);
      tokenCountTimer = null;
    }
  };

  const startSessionWatch = (filePath: string, sessionId: string) => {
    stopSessionWatch();

    currentSessionId = sessionId;
    cachedModel = null;
    cachedCwd = null;
    inTurn = false;
    pendingTokenCountEvent = null;

    // Read from current end (don't replay old turns)
    try {
      lastSize = fs.statSync(filePath).size;
    } catch {
      lastSize = 0;
    }

    // Rewind a small chunk to catch session_meta + turn_context for cwd/model
    try {
      const fileSize = fs.statSync(filePath).size;
      if (fileSize > 0) {
        const REWIND_BYTES = 4096;
        const metaReadStart = 0; // Always read from start for session_meta
        const metaReadSize = Math.min(REWIND_BYTES, fileSize);
        const fd = fs.openSync(filePath, "r");
        const buf = Buffer.alloc(metaReadSize);
        fs.readSync(fd, buf, 0, metaReadSize, metaReadStart);
        fs.closeSync(fd);

        const headerContent = buf.toString("utf-8");
        const headerLines = headerContent.trim().split("\n").filter((l) => l.trim());
        for (const line of headerLines) {
          try {
            const ev: CodexRawEvent = JSON.parse(line);
            // Only process metadata events, not turn events
            if (ev.type === "session_meta" || ev.type === "turn_context") {
              processEvent(ev);
            }
          } catch { /* skip */ }
        }
      }
    } catch { /* ignore */ }

    const dir = path.dirname(filePath);
    const filename = path.basename(filePath);

    // fs.watch for instant notification
    try {
      sessionWatcher = fs.watch(dir, (_, changedFile) => {
        if (changedFile !== filename) return;
        processNewData(filePath);
      });
    } catch (err) {
      console.error("[CodexSessionWatcher] fs.watch failed:", err);
    }

    // Polling fallback
    pollTimer = setInterval(() => {
      processNewData(filePath);
    }, POLL_INTERVAL_MS);

    console.log(`[CodexSessionWatcher] Watching session: ${sessionId.slice(0, 12)}… (model=${cachedModel ?? "unknown"}, cwd=${cachedCwd ?? "unknown"})`);
  };

  // ── History.jsonl Trigger ──

  const onHistoryChange = () => {
    const sessionId = readLastSessionIdFromHistory();
    if (!sessionId || sessionId === currentSessionId) return;

    const filePath = findSessionFileBySessionId(sessionId);
    if (!filePath) {
      console.log(`[CodexSessionWatcher] Session file not found for ${sessionId.slice(0, 12)}…, waiting…`);
      return;
    }

    console.log(`[CodexSessionWatcher] New session from history.jsonl: ${sessionId.slice(0, 12)}…`);
    startSessionWatch(filePath, sessionId);
  };

  // ── Initialization ──

  // 1. Auto-detect most recent session
  const mostRecent = findMostRecentCodexSession();
  if (mostRecent) {
    startSessionWatch(mostRecent.filePath, mostRecent.sessionId);
  } else {
    console.log("[CodexSessionWatcher] No Codex sessions found, waiting for history.jsonl trigger…");
  }

  // 2. Watch history.jsonl for session switches
  if (fs.existsSync(CODEX_HISTORY_PATH)) {
    try {
      historyWatcher = fs.watch(CODEX_HISTORY_PATH, () => onHistoryChange());
      console.log("[CodexSessionWatcher] Watching history.jsonl for session switches");
    } catch (err) {
      console.error("[CodexSessionWatcher] Failed to watch history.jsonl:", err);
    }
  } else {
    console.log("[CodexSessionWatcher] history.jsonl not found, will only track auto-detected session");
  }

  // ── Cleanup ──

  const cleanup = () => {
    stopSessionWatch();
    if (historyWatcher) {
      historyWatcher.close();
      historyWatcher = null;
    }
    console.log("[CodexSessionWatcher] Watcher closed");
  };

  return { cleanup };
};
