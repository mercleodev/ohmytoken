/**
 * Codex JSONL Parser
 *
 * Parses Codex CLI session JSONL files and extracts token usage,
 * tool calls, assistant responses, and conversation metrics.
 *
 * Codex events: session_meta, response_item, event_msg, turn_context.
 *
 * Strategy:
 * 1. Turn boundaries are marked by event_msg(user_message)
 * 2. Token usage comes from event_msg(token_count).total_token_usage (cumulative)
 * 3. Per-turn usage = delta between end-of-turn and start-of-turn cumulative totals
 * 4. Model name from turn_context.payload.model, fallback to context window inference
 * 5. Tool calls from response_item(function_call|custom_tool_call)
 * 6. Assistant response from event_msg(agent_message)
 */
import * as fs from "fs";
import { calculateCodexCost } from "../../utils/costCalculator";
import type { BackfillMessage, BackfillToolCall } from "../types";

type TokenUsage = {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
};

type RawEvent = {
  timestamp?: string;
  type: string;
  payload: {
    type?: string;
    // session_meta fields
    id?: string;
    cwd?: string;
    model_provider?: string;
    // event_msg/user_message
    message?: string;
    // event_msg/agent_message
    phase?: string;
    // event_msg/token_count
    info?: {
      total_token_usage?: TokenUsage;
      last_token_usage?: { input_tokens?: number };
      model_context_window?: number;
    } | null;
    // event_msg/task_started
    model_context_window?: number;
    // turn_context fields
    model?: string;
    // response_item fields
    role?: string;
    name?: string;
    arguments?: string;
    input?: string;
    call_id?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    content?: any[];
  };
};

/**
 * Try to extract a git branch name from the working directory path.
 * Worktree paths often contain branch names (e.g. /project/.worktrees/feature-x/).
 * Returns undefined if no branch can be inferred.
 */
const inferBranchFromCwd = (cwd: string | undefined): string | undefined => {
  if (!cwd) return undefined;
  // Common worktree patterns: .worktrees/<branch>, worktrees/<branch>
  const worktreeMatch = cwd.match(/[/\\]\.?(?:claude-)?worktrees?[/\\]([^/\\]+)/);
  if (worktreeMatch) return worktreeMatch[1];
  return undefined;
};

const USER_PROMPT_LIMIT = 500;
const INPUT_SUMMARY_LIMIT = 200;
const RESPONSE_LIMIT = 2000;
const ZERO_USAGE: TokenUsage = {
  input_tokens: 0,
  cached_input_tokens: 0,
  output_tokens: 0,
  reasoning_output_tokens: 0,
  total_tokens: 0,
};

/**
 * Infer model name from context window size (fallback only).
 */
const inferModelName = (contextWindow: number): string => {
  if (contextWindow <= 200_000) return "o4-mini";
  return "o3"; // 258,400 context window = o3 / gpt-5
};

/**
 * Extract user prompt text from event_msg/user_message payload.
 */
const extractUserPrompt = (message: string | undefined): string | undefined => {
  if (!message) return undefined;
  const trimmed = message.trim().slice(0, USER_PROMPT_LIMIT);
  return trimmed || undefined;
};

/**
 * Extract tool summary from response_item(function_call|custom_tool_call) events.
 */
const extractToolSummary = (
  events: RawEvent[],
  startIdx: number,
  endIdx: number,
): Record<string, number> | undefined => {
  const summary: Record<string, number> = {};
  let found = false;

  for (let i = startIdx; i < endIdx; i++) {
    const ev = events[i];
    if (!ev.payload) continue;
    const pt = ev.payload.type;
    if (
      ev.type === "response_item" &&
      (pt === "function_call" || pt === "custom_tool_call") &&
      ev.payload.name
    ) {
      const name = ev.payload.name;
      summary[name] = (summary[name] || 0) + 1;
      found = true;
    }
  }

  return found ? summary : undefined;
};

/**
 * Extract detailed tool calls from response_item events in a turn range.
 * Includes function_call, custom_tool_call, and web_search_call.
 */
const extractToolCalls = (
  events: RawEvent[],
  startIdx: number,
  endIdx: number,
): BackfillToolCall[] => {
  const calls: BackfillToolCall[] = [];

  for (let i = startIdx; i < endIdx; i++) {
    const ev = events[i];
    if (!ev.payload) continue;
    const pt = ev.payload.type;

    if (ev.type !== "response_item") continue;

    if (pt === "function_call" && ev.payload.name) {
      const args = ev.payload.arguments ?? "";
      let inputSummary = args;
      // For exec_command, extract just the cmd for readability
      if (ev.payload.name === "exec_command") {
        try {
          const parsed = JSON.parse(args);
          inputSummary = parsed.cmd ?? args;
        } catch { /* use raw args */ }
      }
      calls.push({
        name: ev.payload.name,
        inputSummary: inputSummary.slice(0, INPUT_SUMMARY_LIMIT),
        timestamp: ev.timestamp,
      });
    } else if (pt === "custom_tool_call" && ev.payload.name) {
      const input = ev.payload.input ?? "";
      calls.push({
        name: ev.payload.name,
        inputSummary: input.slice(0, INPUT_SUMMARY_LIMIT),
        timestamp: ev.timestamp,
      });
    } else if (pt === "web_search_call") {
      calls.push({
        name: "web_search",
        inputSummary: "",
        timestamp: ev.timestamp,
      });
    }
  }

  return calls;
};

/**
 * Extract assistant response from event_msg/agent_message events in a turn range.
 * Concatenates commentary phase messages.
 */
const extractAssistantResponse = (
  events: RawEvent[],
  startIdx: number,
  endIdx: number,
): string | undefined => {
  const parts: string[] = [];

  for (let i = startIdx; i < endIdx; i++) {
    const ev = events[i];
    if (!ev.payload) continue;
    if (
      ev.type === "event_msg" &&
      ev.payload.type === "agent_message" &&
      ev.payload.message
    ) {
      parts.push(ev.payload.message);
    }
  }

  if (parts.length === 0) return undefined;
  const combined = parts.join("\n\n");
  return combined.slice(0, RESPONSE_LIMIT) || undefined;
};

/**
 * Count assistant messages in a turn range (agent_message events).
 */
const countAssistantMessages = (
  events: RawEvent[],
  startIdx: number,
  endIdx: number,
): number => {
  let count = 0;
  for (let i = startIdx; i < endIdx; i++) {
    const ev = events[i];
    if (!ev.payload) continue;
    if (ev.type === "event_msg" && ev.payload.type === "agent_message") {
      count++;
    }
  }
  return count;
};

/**
 * Parse a Codex session JSONL file into BackfillMessages.
 *
 * Each user turn produces one BackfillMessage with token usage
 * computed from cumulative total_token_usage deltas.
 */
export const parseCodexSessionFile = (
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
  const events: RawEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      /* skip malformed lines */
    }
  }

  if (events.length === 0) return [];

  // Extract cwd from session_meta for branch inference
  let sessionCwd: string | undefined;
  for (const ev of events) {
    if (ev.type === "session_meta" && ev.payload?.cwd) {
      sessionCwd = ev.payload.cwd;
      break;
    }
  }
  const gitBranch = inferBranchFromCwd(sessionCwd);

  // Detect model: prefer turn_context.payload.model, fallback to context window
  let modelName = "";
  let contextWindowModel = "";
  for (const ev of events) {
    if (ev.type === "turn_context" && ev.payload?.model && !modelName) {
      modelName = ev.payload.model;
    }
    if (ev.type === "event_msg" && ev.payload && !contextWindowModel) {
      const ctxWindow =
        ev.payload.model_context_window ??
        ev.payload.info?.model_context_window;
      if (ctxWindow) {
        contextWindowModel = inferModelName(ctxWindow);
      }
    }
  }
  if (!modelName) modelName = contextWindowModel || "o3";

  // Find turn boundaries: event_msg(user_message)
  const turnStarts: { idx: number; message?: string; timestamp?: string }[] = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.type === "event_msg" && ev.payload?.type === "user_message") {
      turnStarts.push({
        idx: i,
        message: ev.payload.message,
        timestamp: ev.timestamp,
      });
    }
  }

  if (turnStarts.length === 0) return [];

  const results: BackfillMessage[] = [];
  let prevTotal: TokenUsage = { ...ZERO_USAGE };

  for (let ti = 0; ti < turnStarts.length; ti++) {
    const turn = turnStarts[ti];
    const nextIdx =
      ti + 1 < turnStarts.length ? turnStarts[ti + 1].idx : events.length;

    // Find the LAST token_count event with total_token_usage in this turn range.
    // Token events appear in duplicate pairs — we want the last unique one.
    // Also track last_token_usage.input_tokens for actual context window fill.
    let lastTotal: TokenUsage | null = null;
    let lastCallInputTokens = 0;
    for (let i = turn.idx; i < nextIdx; i++) {
      const ev = events[i];
      if (
        ev.type === "event_msg" &&
        ev.payload?.type === "token_count" &&
        ev.payload.info?.total_token_usage
      ) {
        lastTotal = ev.payload.info.total_token_usage;
        // last_token_usage.input_tokens = actual context fill for that API call
        if (ev.payload.info.last_token_usage?.input_tokens) {
          lastCallInputTokens = ev.payload.info.last_token_usage.input_tokens;
        }
      }
    }

    if (!lastTotal) continue;

    // Compute per-turn delta from cumulative totals
    const deltaInput = Math.max(0, lastTotal.input_tokens - prevTotal.input_tokens);
    const deltaCached = Math.max(
      0,
      lastTotal.cached_input_tokens - prevTotal.cached_input_tokens,
    );
    const deltaOutput = Math.max(0, lastTotal.output_tokens - prevTotal.output_tokens);
    const deltaReasoning = Math.max(
      0,
      lastTotal.reasoning_output_tokens - prevTotal.reasoning_output_tokens,
    );

    prevTotal = { ...lastTotal };

    // Skip turns with zero tokens
    const totalDelta = deltaInput + deltaOutput;
    if (totalDelta === 0) continue;

    // Map to BackfillMessage token fields:
    // - input: non-cached input (Codex input_tokens includes cached)
    // - cacheRead: cached portion
    // - output: output + reasoning tokens
    // - cacheWrite: 0 (Codex doesn't report cache creation)
    const nonCachedInput = Math.max(0, deltaInput - deltaCached);
    const totalOutput = deltaOutput + deltaReasoning;

    const cost = calculateCodexCost(
      modelName,
      deltaInput,
      totalOutput,
      deltaCached,
    );

    const userPrompt = extractUserPrompt(turn.message);
    const toolSummary = extractToolSummary(events, turn.idx, nextIdx);
    const toolCalls = extractToolCalls(events, turn.idx, nextIdx);
    const assistantResponse = extractAssistantResponse(events, turn.idx, nextIdx);
    const assistantMsgCount = countAssistantMessages(events, turn.idx, nextIdx);
    const timestamp = turn.timestamp ?? new Date().toISOString();

    results.push({
      dedupKey: `codex-${sessionId}-turn-${ti}`,
      client: "codex",
      modelId: modelName,
      sessionId,
      projectPath: projectDir,
      timestamp,
      tokens: {
        input: nonCachedInput,
        output: totalOutput,
        cacheRead: deltaCached,
        cacheWrite: 0,
      },
      // Use last API call's input_tokens as actual context window fill level.
      // Codex makes many API calls per turn; the delta of cumulative totals
      // gives total consumed tokens (not context fill). last_token_usage gives
      // the actual context size of the final API call in the turn.
      totalContextTokens: lastCallInputTokens || undefined,
      costUsd: cost,
      userPrompt,
      toolSummary,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      assistantResponse,
      conversationTurns: turnStarts.length,
      userMessagesCount: 1,
      assistantMessagesCount: assistantMsgCount,
      gitBranch,
    });
  }

  return results;
};
