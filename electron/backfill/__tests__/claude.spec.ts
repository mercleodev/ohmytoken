import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { parseClaudeSessionFile } from "../parsers/claude";

// --- Temp file helpers ---
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "backfill-test-"));
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

const makeUserEntry = (text: string, uuid?: string, timestamp?: string) => ({
  type: "user",
  uuid: uuid ?? `user-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  timestamp: timestamp ?? new Date().toISOString(),
  message: {
    role: "user",
    content: text,
  },
});

const makeAssistantEntry = (
  model: string,
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  },
  requestId?: string,
  timestamp?: string,
) => ({
  type: "assistant",
  uuid: `asst-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  requestId: requestId ?? `req_${Math.random().toString(36).slice(2, 14)}`,
  timestamp: timestamp ?? new Date().toISOString(),
  message: {
    role: "assistant",
    model,
    content: [{ type: "text", text: "response" }],
    usage,
  },
});

const makeToolUseAssistantEntry = (
  model: string,
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  },
  tools: Array<{ name: string; input?: Record<string, unknown> }>,
  requestId?: string,
) => ({
  type: "assistant",
  uuid: `asst-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  requestId: requestId ?? `req_${Math.random().toString(36).slice(2, 14)}`,
  timestamp: new Date().toISOString(),
  message: {
    role: "assistant",
    model,
    content: [
      ...tools.map((t) => ({
        type: "tool_use",
        name: t.name,
        input: t.input ?? {},
      })),
      { type: "text", text: "done" },
    ],
    usage,
  },
});

// --- Tests ---

describe("parseClaudeSessionFile", () => {
  it("parses a simple interactive session", () => {
    const filePath = writeJsonl("test.jsonl", [
      makeUserEntry("Hello world"),
      makeAssistantEntry("claude-opus-4-6", {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 5000,
        cache_creation_input_tokens: 2000,
      }),
    ]);

    const results = parseClaudeSessionFile(filePath, "sess-001", "prj-dir");

    expect(results).toHaveLength(1);
    expect(results[0].client).toBe("claude");
    expect(results[0].modelId).toBe("claude-opus-4-6");
    expect(results[0].sessionId).toBe("sess-001");
    expect(results[0].tokens.input).toBe(100);
    expect(results[0].tokens.output).toBe(50);
    expect(results[0].tokens.cacheRead).toBe(5000);
    expect(results[0].tokens.cacheWrite).toBe(2000);
    expect(results[0].costUsd).toBeGreaterThan(0);
    expect(results[0].userPrompt).toBe("Hello world");
  });

  it("parses multiple turns", () => {
    const filePath = writeJsonl("multi.jsonl", [
      makeUserEntry("First question"),
      makeAssistantEntry("claude-sonnet-4-5-20250929", {
        input_tokens: 50,
        output_tokens: 100,
      }),
      makeUserEntry("Follow up"),
      makeAssistantEntry("claude-sonnet-4-5-20250929", {
        input_tokens: 200,
        output_tokens: 150,
      }),
    ]);

    const results = parseClaudeSessionFile(filePath, "sess-002", "prj-dir");

    expect(results).toHaveLength(2);
    expect(results[0].userPrompt).toBe("First question");
    expect(results[1].userPrompt).toBe("Follow up");
  });

  it("uses last assistant entry with usage for each turn", () => {
    const reqId = "req_shared";
    const filePath = writeJsonl("stream.jsonl", [
      makeUserEntry("Test"),
      makeAssistantEntry(
        "claude-opus-4-6",
        { input_tokens: 10, output_tokens: 5 },
        reqId,
      ),
      makeAssistantEntry(
        "claude-opus-4-6",
        { input_tokens: 10, output_tokens: 50 },
        reqId,
      ),
    ]);

    const results = parseClaudeSessionFile(filePath, "sess-003", "prj-dir");

    expect(results).toHaveLength(1);
    // Should use the last assistant entry (output_tokens=50)
    expect(results[0].tokens.output).toBe(50);
    expect(results[0].dedupKey).toBe(reqId);
  });

  it("skips entries with zero total tokens", () => {
    const filePath = writeJsonl("zero.jsonl", [
      makeUserEntry("Empty response"),
      makeAssistantEntry("claude-opus-4-6", {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      }),
    ]);

    const results = parseClaudeSessionFile(filePath, "sess-004", "prj-dir");

    expect(results).toHaveLength(0);
  });

  it("skips user entries without text content", () => {
    const filePath = writeJsonl("toolonly.jsonl", [
      {
        type: "user",
        uuid: "user-tool-only",
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: [{ type: "tool_result", content: "result" }],
        },
      },
      makeAssistantEntry("claude-opus-4-6", {
        input_tokens: 100,
        output_tokens: 50,
      }),
    ]);

    const results = parseClaudeSessionFile(filePath, "sess-005", "prj-dir");

    expect(results).toHaveLength(0);
  });

  it("strips system-reminder tags from user prompts", () => {
    const filePath = writeJsonl("tags.jsonl", [
      makeUserEntry(
        "Actual prompt <system-reminder>secret info</system-reminder> end",
      ),
      makeAssistantEntry("claude-opus-4-6", {
        input_tokens: 100,
        output_tokens: 50,
      }),
    ]);

    const results = parseClaudeSessionFile(filePath, "sess-006", "prj-dir");

    expect(results).toHaveLength(1);
    expect(results[0].userPrompt).not.toContain("system-reminder");
    expect(results[0].userPrompt).toContain("Actual prompt");
  });

  it("extracts tool_summary from assistant entries", () => {
    const filePath = writeJsonl("tools.jsonl", [
      makeUserEntry("Use some tools"),
      makeToolUseAssistantEntry(
        "claude-opus-4-6",
        { input_tokens: 100, output_tokens: 50 },
        [
          { name: "Read", input: { file_path: "foo.ts" } },
          { name: "Grep", input: { pattern: "bar" } },
          { name: "Read", input: { file_path: "baz.ts" } },
        ],
      ),
    ]);

    const results = parseClaudeSessionFile(filePath, "sess-007", "prj-dir");

    expect(results).toHaveLength(1);
    expect(results[0].toolSummary).toEqual({ Read: 2, Grep: 1 });
  });

  it("handles malformed lines gracefully", () => {
    const filePath = path.join(tmpDir, "malformed.jsonl");
    fs.writeFileSync(
      filePath,
      [
        "not json at all",
        JSON.stringify(makeUserEntry("Valid prompt")),
        "{broken json",
        JSON.stringify(
          makeAssistantEntry("claude-opus-4-6", {
            input_tokens: 100,
            output_tokens: 50,
          }),
        ),
      ].join("\n"),
    );

    const results = parseClaudeSessionFile(filePath, "sess-008", "prj-dir");

    expect(results).toHaveLength(1);
    expect(results[0].userPrompt).toBe("Valid prompt");
  });

  it("returns empty array for non-existent file", () => {
    const results = parseClaudeSessionFile(
      "/nonexistent/path.jsonl",
      "sess-009",
      "prj-dir",
    );
    expect(results).toHaveLength(0);
  });

  it("handles empty file", () => {
    const filePath = writeJsonl("empty.jsonl", []);
    // writeJsonl writes empty string for empty array
    fs.writeFileSync(filePath, "");

    const results = parseClaudeSessionFile(filePath, "sess-010", "prj-dir");
    expect(results).toHaveLength(0);
  });

  it("deduplicates within same file by requestId", () => {
    const reqId = "req_dup";
    const filePath = writeJsonl("intra-dup.jsonl", [
      makeUserEntry("First"),
      makeAssistantEntry(
        "claude-opus-4-6",
        { input_tokens: 100, output_tokens: 50 },
        reqId,
      ),
      makeUserEntry("Second"),
      // Same requestId appears again (rare but possible)
      makeAssistantEntry(
        "claude-opus-4-6",
        { input_tokens: 200, output_tokens: 100 },
        reqId,
      ),
    ]);

    const results = parseClaudeSessionFile(filePath, "sess-011", "prj-dir");

    // Only first occurrence with this requestId should be included
    expect(results).toHaveLength(1);
    expect(results[0].dedupKey).toBe(reqId);
  });

  it("handles array content in user messages", () => {
    const filePath = writeJsonl("array-content.jsonl", [
      {
        type: "user",
        uuid: "user-array",
        timestamp: new Date().toISOString(),
        message: {
          role: "user",
          content: [
            { type: "text", text: "Hello from array" },
            { type: "tool_result", content: "some result" },
          ],
        },
      },
      makeAssistantEntry("claude-opus-4-6", {
        input_tokens: 100,
        output_tokens: 50,
      }),
    ]);

    const results = parseClaudeSessionFile(filePath, "sess-012", "prj-dir");

    expect(results).toHaveLength(1);
    expect(results[0].userPrompt).toBe("Hello from array");
  });
});
