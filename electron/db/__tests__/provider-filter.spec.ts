import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDatabase, closeDatabase } from "../index";
import { insertPrompt, clearStatementCache } from "../writer";
import type { InsertPromptData } from "../writer";
import {
  getPrompts,
  getSessionList,
  getDailyStats,
  getTokenComposition,
  getOutputProductivity,
} from "../reader";

// --- Test helpers ---

const makePromptData = (
  overrides: Partial<InsertPromptData["prompt"]> = {},
): InsertPromptData => ({
  prompt: {
    request_id: `req-pf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    session_id: "sess-pf-001",
    timestamp: "2026-02-15T10:00:00.000Z",
    source: "file-scan",
    provider: "claude",
    model: "claude-opus-4-6",
    input_tokens: 100,
    output_tokens: 50,
    cache_creation_input_tokens: 200,
    cache_read_input_tokens: 5000,
    cost_usd: 0.05,
    total_context_tokens: 5350,
    ...overrides,
  },
  injected_files: [],
  tool_calls: [],
  agent_calls: [],
});

// --- Setup / Teardown ---

beforeEach(() => {
  clearStatementCache();
  initDatabase(":memory:");
});

afterEach(() => {
  closeDatabase();
});

// ============================================
// Provider Filter — getPrompts
// ============================================

describe("getPrompts provider filter", () => {
  it("returns all prompts when provider is omitted", () => {
    insertPrompt(
      makePromptData({
        request_id: "req-all-claude",
        provider: "claude",
      }),
    );
    insertPrompt(
      makePromptData({
        request_id: "req-all-codex",
        provider: "codex",
        model: "o3",
      }),
    );

    const all = getPrompts({ limit: 50 });
    expect(all).toHaveLength(2);
  });

  it("filters by provider='claude'", () => {
    insertPrompt(
      makePromptData({
        request_id: "req-fc-claude",
        provider: "claude",
      }),
    );
    insertPrompt(
      makePromptData({
        request_id: "req-fc-codex",
        provider: "codex",
        model: "o3",
      }),
    );

    const claude = getPrompts({ provider: "claude", limit: 50 });
    expect(claude).toHaveLength(1);
    expect(claude[0].request_id).toBe("req-fc-claude");
  });

  it("filters by provider='codex'", () => {
    insertPrompt(
      makePromptData({
        request_id: "req-fx-claude",
        provider: "claude",
      }),
    );
    insertPrompt(
      makePromptData({
        request_id: "req-fx-codex",
        provider: "codex",
        model: "o3",
      }),
    );

    const codex = getPrompts({ provider: "codex", limit: 50 });
    expect(codex).toHaveLength(1);
    expect(codex[0].request_id).toBe("req-fx-codex");
  });
});

// ============================================
// Provider Filter — getSessionList
// ============================================

describe("getSessionList provider filter", () => {
  it("returns all sessions when provider is omitted", () => {
    insertPrompt(
      makePromptData({
        request_id: "req-sl-claude",
        session_id: "sess-claude-001",
        provider: "claude",
      }),
    );
    insertPrompt(
      makePromptData({
        request_id: "req-sl-codex",
        session_id: "sess-codex-001",
        provider: "codex",
        model: "o3",
      }),
    );

    const all = getSessionList(20);
    expect(all).toHaveLength(2);
  });

  it("filters sessions by provider", () => {
    insertPrompt(
      makePromptData({
        request_id: "req-slf-claude",
        session_id: "sess-claude-002",
        provider: "claude",
      }),
    );
    insertPrompt(
      makePromptData({
        request_id: "req-slf-codex",
        session_id: "sess-codex-002",
        provider: "codex",
        model: "o3",
      }),
    );

    const claude = getSessionList(20, "claude");
    expect(claude).toHaveLength(1);
    expect(claude[0].session_id).toBe("sess-claude-002");

    const codex = getSessionList(20, "codex");
    expect(codex).toHaveLength(1);
    expect(codex[0].session_id).toBe("sess-codex-002");
  });
});

// ============================================
// Provider Filter — getDailyStats
// ============================================

describe("getDailyStats provider filter", () => {
  it("returns stats for all providers when omitted", () => {
    insertPrompt(
      makePromptData({
        request_id: "req-ds-claude",
        provider: "claude",
        cost_usd: 0.1,
      }),
    );
    insertPrompt(
      makePromptData({
        request_id: "req-ds-codex",
        provider: "codex",
        model: "o3",
        cost_usd: 0.2,
      }),
    );

    const all = getDailyStats();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it("filters daily stats by provider", () => {
    insertPrompt(
      makePromptData({
        request_id: "req-dsf-claude",
        provider: "claude",
        cost_usd: 0.1,
      }),
    );
    insertPrompt(
      makePromptData({
        request_id: "req-dsf-codex",
        provider: "codex",
        model: "o3",
        cost_usd: 0.2,
      }),
    );

    const claude = getDailyStats(undefined, "claude");
    expect(claude).toHaveLength(1);
    expect(claude[0].total_cost_usd).toBeCloseTo(0.1);

    const codex = getDailyStats(undefined, "codex");
    expect(codex).toHaveLength(1);
    expect(codex[0].total_cost_usd).toBeCloseTo(0.2);
  });
});

// ============================================
// Provider Filter — getTokenComposition
// ============================================

describe("getTokenComposition provider filter", () => {
  it("aggregates all providers when omitted", () => {
    insertPrompt(
      makePromptData({
        request_id: "req-tc-claude",
        provider: "claude",
        timestamp: new Date().toISOString(),
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 5000,
        cache_creation_input_tokens: 200,
      }),
    );
    insertPrompt(
      makePromptData({
        request_id: "req-tc-codex",
        provider: "codex",
        model: "o3",
        timestamp: new Date().toISOString(),
        input_tokens: 200,
        output_tokens: 80,
        cache_read_input_tokens: 3000,
        cache_creation_input_tokens: 100,
      }),
    );

    const all = getTokenComposition("30d");
    expect(all.input).toBe(300);
    expect(all.output).toBe(130);
    expect(all.cache_read).toBe(8000);
  });

  it("filters token composition by provider", () => {
    insertPrompt(
      makePromptData({
        request_id: "req-tcf-claude",
        provider: "claude",
        timestamp: new Date().toISOString(),
        input_tokens: 100,
        output_tokens: 50,
      }),
    );
    insertPrompt(
      makePromptData({
        request_id: "req-tcf-codex",
        provider: "codex",
        model: "o3",
        timestamp: new Date().toISOString(),
        input_tokens: 200,
        output_tokens: 80,
      }),
    );

    const claude = getTokenComposition("30d", "claude");
    expect(claude.input).toBe(100);
    expect(claude.output).toBe(50);

    const codex = getTokenComposition("30d", "codex");
    expect(codex.input).toBe(200);
    expect(codex.output).toBe(80);
  });
});

// ============================================
// Provider Filter — getOutputProductivity
// ============================================

describe("getOutputProductivity provider filter", () => {
  it("aggregates all providers when omitted", () => {
    const now = new Date().toISOString();
    insertPrompt(
      makePromptData({
        request_id: "req-op-claude",
        provider: "claude",
        timestamp: now,
        input_tokens: 100,
        output_tokens: 50,
        cost_usd: 0.05,
      }),
    );
    insertPrompt(
      makePromptData({
        request_id: "req-op-codex",
        provider: "codex",
        model: "o3",
        timestamp: now,
        input_tokens: 200,
        output_tokens: 80,
        cost_usd: 0.1,
      }),
    );

    const all = getOutputProductivity();
    expect(all.todayOutputTokens).toBe(130);
  });

  it("filters output productivity by provider", () => {
    const now = new Date().toISOString();
    insertPrompt(
      makePromptData({
        request_id: "req-opf-claude",
        provider: "claude",
        timestamp: now,
        output_tokens: 50,
      }),
    );
    insertPrompt(
      makePromptData({
        request_id: "req-opf-codex",
        provider: "codex",
        model: "o3",
        timestamp: now,
        output_tokens: 80,
      }),
    );

    const claude = getOutputProductivity("claude");
    expect(claude.todayOutputTokens).toBe(50);

    const codex = getOutputProductivity("codex");
    expect(codex.todayOutputTokens).toBe(80);
  });
});
