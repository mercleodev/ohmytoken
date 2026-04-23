/**
 * Regression test for #299 follow-up.
 *
 * The HumanTurn handler in main.ts used to compute per-session stats via:
 *   scans = getSessionPrompts(sessionId)           // 1 main query + 3N sub-queries
 *   for (s of scans) getPromptDetail(s.request_id) // 5N more queries
 *   // …then a second getSessionPrompts(sessionId) for last model
 *
 * With 100-prompt sessions that is 800+ synchronous DB queries on the main
 * thread per HumanTurn. getSessionStatsSummary replaces the whole block with
 * one aggregation query over the dedup-CTE view.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDatabase, closeDatabase } from "../index";
import { insertPrompt, clearStatementCache } from "../writer";
import { getSessionStatsSummary } from "../reader";
import type { InsertPromptData } from "../writer";

const makePrompt = (overrides: Partial<InsertPromptData["prompt"]> = {}): InsertPromptData => ({
  prompt: {
    request_id: `req-${Math.random().toString(36).slice(2, 10)}`,
    session_id: "sess-sum",
    timestamp: "2026-04-23T10:00:00.000Z",
    source: "proxy",
    user_prompt: "hi",
    user_prompt_tokens: 5,
    model: "claude-opus-4-7",
    max_tokens: 8192,
    system_tokens: 0,
    messages_tokens: 0,
    user_text_tokens: 0,
    assistant_tokens: 0,
    tool_result_tokens: 0,
    tools_definition_tokens: 0,
    total_context_tokens: 0,
    total_injected_tokens: 0,
    input_tokens: 10,
    output_tokens: 20,
    cache_creation_input_tokens: 30,
    cache_read_input_tokens: 40,
    cost_usd: 0.01,
    duration_ms: 100,
    ...overrides,
  },
  injected_files: [],
  tool_calls: [],
  agent_calls: [],
});

beforeEach(() => {
  clearStatementCache();
  initDatabase(":memory:");
});

afterEach(() => {
  closeDatabase();
});

describe("getSessionStatsSummary (#299 follow-up)", () => {
  it("returns zero-valued summary when the session has no prompts", () => {
    const summary = getSessionStatsSummary("sess-missing");
    expect(summary).toEqual({
      turns: 0,
      totalCostUsd: 0,
      totalTokens: 0,
      totalCacheRead: 0,
      lastModel: null,
    });
  });

  it("sums cost, tokens, cache-read across every prompt in the session", () => {
    insertPrompt(makePrompt({
      request_id: "r-1",
      timestamp: "2026-04-23T10:00:00.000Z",
      cost_usd: 0.10,
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 200,
      cache_creation_input_tokens: 0,
    }));
    insertPrompt(makePrompt({
      request_id: "r-2",
      timestamp: "2026-04-23T10:01:00.000Z",
      cost_usd: 0.25,
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 300,
      cache_creation_input_tokens: 15,
    }));

    const summary = getSessionStatsSummary("sess-sum");
    expect(summary.turns).toBe(2);
    expect(summary.totalCostUsd).toBeCloseTo(0.35, 5);
    // 100+50+200+0 + 10+5+300+15 = 680
    expect(summary.totalTokens).toBe(680);
    // 200 + 300 = 500
    expect(summary.totalCacheRead).toBe(500);
  });

  it("returns the most recent model as lastModel (by timestamp DESC)", () => {
    insertPrompt(makePrompt({
      request_id: "r-old",
      timestamp: "2026-04-23T09:00:00.000Z",
      model: "claude-opus-4-6",
    }));
    insertPrompt(makePrompt({
      request_id: "r-new",
      timestamp: "2026-04-23T11:00:00.000Z",
      model: "claude-sonnet-4-6",
    }));

    const summary = getSessionStatsSummary("sess-sum");
    expect(summary.lastModel).toBe("claude-sonnet-4-6");
  });

  it("dedupes duplicate (session_id, timestamp) rows (history wins over proxy)", () => {
    const SAME_TS = "2026-04-23T10:00:00.000Z";
    insertPrompt(makePrompt({
      request_id: "r-proxy",
      timestamp: SAME_TS,
      source: "proxy",
      cost_usd: 0.50,
      input_tokens: 1000,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    }));
    insertPrompt(makePrompt({
      request_id: "r-hist",
      timestamp: SAME_TS,
      source: "history",
      cost_usd: 0.20,
      input_tokens: 10,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    }));

    const summary = getSessionStatsSummary("sess-sum");
    // Both rows share (session_id, timestamp); history is preferred.
    expect(summary.turns).toBe(1);
    expect(summary.totalCostUsd).toBeCloseTo(0.20, 5);
    expect(summary.totalTokens).toBe(10);
  });

  it("isolates stats by session_id", () => {
    insertPrompt(makePrompt({
      request_id: "a-1",
      session_id: "sess-A",
      cost_usd: 1.0,
      input_tokens: 100,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    }));
    insertPrompt(makePrompt({
      request_id: "b-1",
      session_id: "sess-B",
      cost_usd: 2.0,
      input_tokens: 200,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    }));

    const a = getSessionStatsSummary("sess-A");
    const b = getSessionStatsSummary("sess-B");
    expect(a.turns).toBe(1);
    expect(a.totalCostUsd).toBeCloseTo(1.0, 5);
    expect(b.turns).toBe(1);
    expect(b.totalCostUsd).toBeCloseTo(2.0, 5);
  });
});
