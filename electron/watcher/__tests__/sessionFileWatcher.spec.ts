/**
 * Unit tests for sessionFileWatcher's per-line turn classification.
 *
 * Background (#263): Claude session JSONL splits a single assistant message
 * into separate lines per content block (thinking / text / tool_use). The
 * previous implementation only checked whether a tool_use block existed on
 * the current line, so the thinking/text lines of a tool_use turn were
 * incorrectly classified as "turn complete". We now look at `stop_reason`.
 */

import { describe, it, expect } from "vitest";
import { shouldEmitAssistantTurn } from "../sessionFileWatcher";

describe("shouldEmitAssistantTurn", () => {
  it("returns false when stop_reason is tool_use and block is thinking-only", () => {
    const line = {
      type: "assistant",
      message: {
        stop_reason: "tool_use",
        usage: { output_tokens: 263 },
        content: [{ type: "thinking", thinking: "..." }],
      },
    };
    expect(shouldEmitAssistantTurn(line)).toBe(false);
  });

  it("returns false when stop_reason is tool_use and block is text-only", () => {
    const line = {
      type: "assistant",
      message: {
        stop_reason: "tool_use",
        usage: { output_tokens: 263 },
        content: [{ type: "text", text: "Let me check the file." }],
      },
    };
    expect(shouldEmitAssistantTurn(line)).toBe(false);
  });

  it("returns false when stop_reason is tool_use and block is tool_use", () => {
    const line = {
      type: "assistant",
      message: {
        stop_reason: "tool_use",
        usage: { output_tokens: 263 },
        content: [{ type: "tool_use", name: "Read", input: {} }],
      },
    };
    expect(shouldEmitAssistantTurn(line)).toBe(false);
  });

  it("returns true when stop_reason is end_turn with positive output tokens", () => {
    const line = {
      type: "assistant",
      message: {
        stop_reason: "end_turn",
        usage: { output_tokens: 86 },
        content: [{ type: "text", text: "All done." }],
      },
    };
    expect(shouldEmitAssistantTurn(line)).toBe(true);
  });

  it("returns false when stop_reason is end_turn but output tokens is 0 (cancelled)", () => {
    const line = {
      type: "assistant",
      message: {
        stop_reason: "end_turn",
        usage: { output_tokens: 0 },
        content: [{ type: "text", text: "" }],
      },
    };
    expect(shouldEmitAssistantTurn(line)).toBe(false);
  });

  it("returns true for stop_reason=stop_sequence with output (turn-ending)", () => {
    const line = {
      type: "assistant",
      message: {
        stop_reason: "stop_sequence",
        usage: { output_tokens: 42 },
        content: [{ type: "text", text: "Stopped." }],
      },
    };
    expect(shouldEmitAssistantTurn(line)).toBe(true);
  });

  it("returns false when stop_reason is missing (conservative)", () => {
    const line = {
      type: "assistant",
      message: {
        usage: { output_tokens: 100 },
        content: [{ type: "text", text: "..." }],
      },
    };
    expect(shouldEmitAssistantTurn(line)).toBe(false);
  });

  it("returns false when message is missing entirely", () => {
    expect(shouldEmitAssistantTurn({ type: "assistant" })).toBe(false);
  });
});
