/**
 * Codex JSONL Parser
 *
 * Parses Codex CLI session JSONL files and extracts token usage.
 * Codex events: session_meta, response_item, event_msg, turn_context.
 *
 * Strategy:
 * 1. Turn boundaries are marked by event_msg(user_message)
 * 2. Token usage comes from event_msg(token_count).total_token_usage (cumulative)
 * 3. Per-turn usage = delta between end-of-turn and start-of-turn cumulative totals
 * 4. Model name inferred from model_context_window (not explicit in Codex data)
 */
import * as fs from "fs";
import { calculateCodexCost } from "../../utils/costCalculator";
import type { BackfillMessage } from "../types";

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
    // event_msg/token_count
    info?: {
      total_token_usage?: TokenUsage;
      last_token_usage?: TokenUsage;
      model_context_window?: number;
    } | null;
    // event_msg/task_started
    model_context_window?: number;
    // response_item fields
    role?: string;
    name?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    content?: any[];
  };
};

const USER_PROMPT_LIMIT = 500;
const ZERO_USAGE: TokenUsage = {
  input_tokens: 0,
  cached_input_tokens: 0,
  output_tokens: 0,
  reasoning_output_tokens: 0,
  total_tokens: 0,
};

/**
 * Infer model name from context window size.
 * Codex JSONL doesn't include explicit model names.
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
 * Extract tool summary from response_item(function_call) events in a range.
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
    if (
      ev.type === "response_item" &&
      ev.payload.type === "function_call" &&
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

  // Detect model from task_started or token_count context window
  let modelName = "o3"; // default
  for (const ev of events) {
    if (ev.type === "event_msg") {
      const ctxWindow =
        ev.payload.model_context_window ??
        ev.payload.info?.model_context_window;
      if (ctxWindow) {
        modelName = inferModelName(ctxWindow);
        break;
      }
    }
  }

  // Find turn boundaries: event_msg(user_message)
  const turnStarts: { idx: number; message?: string; timestamp?: string }[] = [];
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.type === "event_msg" && ev.payload.type === "user_message") {
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
    let lastTotal: TokenUsage | null = null;
    for (let i = turn.idx; i < nextIdx; i++) {
      const ev = events[i];
      if (
        ev.type === "event_msg" &&
        ev.payload.type === "token_count" &&
        ev.payload.info?.total_token_usage
      ) {
        lastTotal = ev.payload.info.total_token_usage;
      }
    }

    if (!lastTotal) continue;

    // Compute per-turn delta from cumulative totals
    const deltaInput = lastTotal.input_tokens - prevTotal.input_tokens;
    const deltaCached =
      lastTotal.cached_input_tokens - prevTotal.cached_input_tokens;
    const deltaOutput = lastTotal.output_tokens - prevTotal.output_tokens;
    const deltaReasoning =
      lastTotal.reasoning_output_tokens - prevTotal.reasoning_output_tokens;

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
      costUsd: cost,
      userPrompt,
      toolSummary,
    });
  }

  return results;
};
