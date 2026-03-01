import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parseCodexSessionFile } from "../parsers/codex";

// --- Temp file helpers ---
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const writeJsonl = (filename: string, entries: unknown[]): string => {
  const filePath = path.join(tmpDir, filename);
  fs.writeFileSync(filePath, entries.map((e) => JSON.stringify(e)).join("\n"));
  return filePath;
};

// --- Test data builders ---

const makeSessionMeta = (opts?: {
  id?: string;
  cwd?: string;
  model_provider?: string;
  cli_version?: string;
}) => ({
  timestamp: new Date().toISOString(),
  type: "session_meta",
  payload: {
    id: opts?.id ?? "019c70ed-111e-7773-af88-69f2848d3876",
    timestamp: new Date().toISOString(),
    cwd: opts?.cwd ?? "/tmp/test-project",
    originator: "codex_cli_rs",
    cli_version: opts?.cli_version ?? "0.104.0",
    source: "cli",
    model_provider: opts?.model_provider ?? "openai",
  },
});

const makeUserMessage = (text: string, timestamp?: string) => ({
  timestamp: timestamp ?? new Date().toISOString(),
  type: "event_msg",
  payload: {
    type: "user_message",
    message: text,
  },
});

const makeUserResponseItem = (text: string) => ({
  timestamp: new Date().toISOString(),
  type: "response_item",
  payload: {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
  },
});

const makeTaskStarted = (contextWindow?: number) => ({
  timestamp: new Date().toISOString(),
  type: "event_msg",
  payload: {
    type: "task_started",
    turn_id: `turn-${Math.random().toString(36).slice(2)}`,
    model_context_window: contextWindow ?? 258400,
    collaboration_mode_kind: "default",
  },
});

const makeTokenCount = (
  total: {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    reasoning_output_tokens: number;
  },
  last?: {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    reasoning_output_tokens: number;
  },
) => ({
  timestamp: new Date().toISOString(),
  type: "event_msg",
  payload: {
    type: "token_count",
    info: {
      total_token_usage: {
        ...total,
        total_tokens: total.input_tokens + total.output_tokens,
      },
      last_token_usage: {
        ...(last ?? total),
        total_tokens: (last ?? total).input_tokens + (last ?? total).output_tokens,
      },
      model_context_window: 258400,
    },
    rate_limits: {
      limit_id: "codex",
      credits: { has_credits: true, unlimited: true },
    },
  },
});

const makeFunctionCall = (name: string) => ({
  timestamp: new Date().toISOString(),
  type: "response_item",
  payload: {
    type: "function_call",
    call_id: `call_${Math.random().toString(36).slice(2)}`,
    name,
    arguments: '{"command":["ls"]}',
  },
});

const makeFunctionCallOutput = () => ({
  timestamp: new Date().toISOString(),
  type: "response_item",
  payload: {
    type: "function_call_output",
    call_id: `call_${Math.random().toString(36).slice(2)}`,
    output: "output text",
  },
});

const makeTurnContext = () => ({
  timestamp: new Date().toISOString(),
  type: "turn_context",
});

// --- Tests ---

describe("parseCodexSessionFile", () => {
  it("parses a single-turn Codex session", () => {
    const ts = "2026-02-27T22:14:56.000Z";
    const filePath = writeJsonl("single-turn.jsonl", [
      makeSessionMeta(),
      makeUserResponseItem("Hello Codex"),
      makeUserMessage("Hello Codex", ts),
      makeTaskStarted(),
      makeTokenCount({
        input_tokens: 10000,
        cached_input_tokens: 6000,
        output_tokens: 500,
        reasoning_output_tokens: 200,
      }),
    ]);

    const results = parseCodexSessionFile(filePath, "sess-001", "/test/project");

    expect(results).toHaveLength(1);
    expect(results[0].client).toBe("codex");
    expect(results[0].modelId).toBe("o3");
    expect(results[0].sessionId).toBe("sess-001");
    expect(results[0].projectPath).toBe("/test/project");
    expect(results[0].timestamp).toBe(ts);
    // input = non-cached = 10000 - 6000 = 4000
    expect(results[0].tokens.input).toBe(4000);
    expect(results[0].tokens.cacheRead).toBe(6000);
    // output = output + reasoning = 500 + 200 = 700
    expect(results[0].tokens.output).toBe(700);
    expect(results[0].tokens.cacheWrite).toBe(0);
    expect(results[0].costUsd).toBeGreaterThan(0);
    expect(results[0].userPrompt).toBe("Hello Codex");
    expect(results[0].dedupKey).toBe("codex-sess-001-turn-0");
    // totalContextTokens = last_token_usage.input_tokens (= total when no last override)
    expect(results[0].totalContextTokens).toBe(10000);
  });

  it("uses last_token_usage for totalContextTokens in multi-call turns", () => {
    // Simulates an agentic turn with many API calls:
    // total_token_usage grows cumulatively, but last_token_usage reflects the
    // final API call's actual context window fill.
    const filePath = writeJsonl("multi-call-turn.jsonl", [
      makeSessionMeta(),
      makeUserResponseItem("Analyze the project"),
      makeUserMessage("Analyze the project"),
      makeTaskStarted(),
      // After many internal API calls, cumulative total is high
      // but the last call's input is what reflects actual context fill.
      makeTokenCount(
        {
          input_tokens: 500000,
          cached_input_tokens: 400000,
          output_tokens: 5000,
          reasoning_output_tokens: 2000,
        },
        {
          // last API call only used 170k context
          input_tokens: 170000,
          cached_input_tokens: 160000,
          output_tokens: 200,
          reasoning_output_tokens: 100,
        },
      ),
    ]);

    const results = parseCodexSessionFile(filePath, "sess-ctx", "/test/project");

    expect(results).toHaveLength(1);
    // totalContextTokens should be from last_token_usage, not the delta
    expect(results[0].totalContextTokens).toBe(170000);
    // tokens.input/cacheRead should still reflect the full delta
    expect(results[0].tokens.input).toBe(100000); // 500000 - 400000
    expect(results[0].tokens.cacheRead).toBe(400000);
  });

  it("parses multi-turn sessions with correct deltas", () => {
    const filePath = writeJsonl("multi-turn.jsonl", [
      makeSessionMeta(),
      makeUserResponseItem("First question"),
      makeUserMessage("First question"),
      makeTaskStarted(),
      // Turn 1 ends with total: input=10000, output=500
      makeTokenCount({
        input_tokens: 10000,
        cached_input_tokens: 6000,
        output_tokens: 500,
        reasoning_output_tokens: 200,
      }),
      makeUserResponseItem("Second question"),
      makeUserMessage("Second question"),
      makeTaskStarted(),
      // Turn 2 ends with total: input=25000, output=1200
      // Delta: input=15000, output=700
      makeTokenCount({
        input_tokens: 25000,
        cached_input_tokens: 14000,
        output_tokens: 1200,
        reasoning_output_tokens: 500,
      }),
    ]);

    const results = parseCodexSessionFile(filePath, "sess-002", "/test/project");

    expect(results).toHaveLength(2);

    // Turn 1: full values (no previous)
    expect(results[0].userPrompt).toBe("First question");
    expect(results[0].tokens.input).toBe(4000); // 10000 - 6000
    expect(results[0].tokens.cacheRead).toBe(6000);
    expect(results[0].tokens.output).toBe(700); // 500 + 200

    // Turn 2: delta from turn 1
    expect(results[1].userPrompt).toBe("Second question");
    expect(results[1].tokens.input).toBe(7000); // (25000-10000) - (14000-6000)
    expect(results[1].tokens.cacheRead).toBe(8000); // 14000 - 6000
    expect(results[1].tokens.output).toBe(1000); // (1200-500) + (500-200)
    expect(results[1].dedupKey).toBe("codex-sess-002-turn-1");
  });

  it("handles duplicate token_count events (Codex emits pairs)", () => {
    const filePath = writeJsonl("duplicates.jsonl", [
      makeSessionMeta(),
      makeUserResponseItem("Test"),
      makeUserMessage("Test"),
      makeTaskStarted(),
      makeTokenCount({
        input_tokens: 5000,
        cached_input_tokens: 3000,
        output_tokens: 200,
        reasoning_output_tokens: 100,
      }),
      makeTurnContext(),
      // Duplicate of the same token_count
      makeTokenCount({
        input_tokens: 5000,
        cached_input_tokens: 3000,
        output_tokens: 200,
        reasoning_output_tokens: 100,
      }),
    ]);

    const results = parseCodexSessionFile(filePath, "sess-003", "/test/project");

    expect(results).toHaveLength(1);
    // Should use the last total (which is the same as the first due to duplication)
    expect(results[0].tokens.input).toBe(2000); // 5000 - 3000
    expect(results[0].tokens.output).toBe(300); // 200 + 100
  });

  it("extracts tool summary from function_call events", () => {
    const filePath = writeJsonl("tools.jsonl", [
      makeSessionMeta(),
      makeUserResponseItem("Do some work"),
      makeUserMessage("Do some work"),
      makeTaskStarted(),
      makeFunctionCall("shell"),
      makeFunctionCallOutput(),
      makeFunctionCall("file_read"),
      makeFunctionCallOutput(),
      makeFunctionCall("shell"),
      makeFunctionCallOutput(),
      makeTokenCount({
        input_tokens: 10000,
        cached_input_tokens: 5000,
        output_tokens: 300,
        reasoning_output_tokens: 100,
      }),
    ]);

    const results = parseCodexSessionFile(filePath, "sess-004", "/test/project");

    expect(results).toHaveLength(1);
    expect(results[0].toolSummary).toEqual({ shell: 2, file_read: 1 });
  });

  it("infers o4-mini from small context window", () => {
    const filePath = writeJsonl("o4mini.jsonl", [
      makeSessionMeta(),
      makeUserResponseItem("Test"),
      makeUserMessage("Test"),
      {
        timestamp: new Date().toISOString(),
        type: "event_msg",
        payload: {
          type: "task_started",
          turn_id: "turn-1",
          model_context_window: 200000,
          collaboration_mode_kind: "default",
        },
      },
      makeTokenCount({
        input_tokens: 1000,
        cached_input_tokens: 500,
        output_tokens: 100,
        reasoning_output_tokens: 50,
      }),
    ]);

    const results = parseCodexSessionFile(filePath, "sess-005", "/test/project");

    expect(results).toHaveLength(1);
    expect(results[0].modelId).toBe("o4-mini");
  });

  it("skips turns with zero token deltas", () => {
    const filePath = writeJsonl("zero-delta.jsonl", [
      makeSessionMeta(),
      makeUserResponseItem("First"),
      makeUserMessage("First"),
      makeTaskStarted(),
      makeTokenCount({
        input_tokens: 5000,
        cached_input_tokens: 3000,
        output_tokens: 200,
        reasoning_output_tokens: 100,
      }),
      makeUserResponseItem("Second"),
      makeUserMessage("Second"),
      // No token_count for this turn
    ]);

    const results = parseCodexSessionFile(filePath, "sess-006", "/test/project");

    expect(results).toHaveLength(1);
    expect(results[0].userPrompt).toBe("First");
  });

  it("truncates user prompt to 500 chars", () => {
    const longPrompt = "x".repeat(600);
    const filePath = writeJsonl("long-prompt.jsonl", [
      makeSessionMeta(),
      makeUserResponseItem(longPrompt),
      makeUserMessage(longPrompt),
      makeTaskStarted(),
      makeTokenCount({
        input_tokens: 1000,
        cached_input_tokens: 0,
        output_tokens: 100,
        reasoning_output_tokens: 0,
      }),
    ]);

    const results = parseCodexSessionFile(filePath, "sess-007", "/test/project");

    expect(results).toHaveLength(1);
    expect(results[0].userPrompt).toHaveLength(500);
  });

  it("handles malformed lines gracefully", () => {
    const filePath = path.join(tmpDir, "malformed.jsonl");
    fs.writeFileSync(
      filePath,
      [
        JSON.stringify(makeSessionMeta()),
        "not json at all",
        JSON.stringify(makeUserResponseItem("Valid")),
        "{broken",
        JSON.stringify(makeUserMessage("Valid")),
        JSON.stringify(makeTaskStarted()),
        JSON.stringify(
          makeTokenCount({
            input_tokens: 1000,
            cached_input_tokens: 500,
            output_tokens: 100,
            reasoning_output_tokens: 50,
          }),
        ),
      ].join("\n"),
    );

    const results = parseCodexSessionFile(filePath, "sess-008", "/test/project");

    expect(results).toHaveLength(1);
    expect(results[0].userPrompt).toBe("Valid");
  });

  it("returns empty array for non-existent file", () => {
    const results = parseCodexSessionFile(
      "/nonexistent/codex.jsonl",
      "sess-009",
      "/test",
    );
    expect(results).toHaveLength(0);
  });

  it("returns empty array for empty file", () => {
    const filePath = path.join(tmpDir, "empty.jsonl");
    fs.writeFileSync(filePath, "");

    const results = parseCodexSessionFile(filePath, "sess-010", "/test");
    expect(results).toHaveLength(0);
  });

  it("returns empty array for session with no user_message events", () => {
    const filePath = writeJsonl("no-turns.jsonl", [
      makeSessionMeta(),
      makeTokenCount({
        input_tokens: 1000,
        cached_input_tokens: 0,
        output_tokens: 100,
        reasoning_output_tokens: 0,
      }),
    ]);

    const results = parseCodexSessionFile(filePath, "sess-011", "/test");
    expect(results).toHaveLength(0);
  });

  it("handles token_count with null info gracefully", () => {
    const filePath = writeJsonl("null-info.jsonl", [
      makeSessionMeta(),
      makeUserResponseItem("Test"),
      makeUserMessage("Test"),
      makeTaskStarted(),
      {
        timestamp: new Date().toISOString(),
        type: "event_msg",
        payload: {
          type: "token_count",
          info: null,
          rate_limits: { credits: { has_credits: true } },
        },
      },
    ]);

    const results = parseCodexSessionFile(filePath, "sess-012", "/test");
    // No valid token data → no results
    expect(results).toHaveLength(0);
  });
});
