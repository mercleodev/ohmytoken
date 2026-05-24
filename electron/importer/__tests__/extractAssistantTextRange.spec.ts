/**
 * Issue #378 — history importer must aggregate assistant text across the
 * full turn range, not the single `usage`-bearing entry. When the first
 * assistant entry is `thinking`-only the current implementation persists
 * an empty `assistant_response`, which silently drains every text-overlap
 * and instruction-compliance evidence signal.
 */

import { describe, it, expect } from "vitest";
import { extractAssistantTextRange } from "../extractAssistantTextRange";

type Entry = {
  type: string;
  message?: {
    content?: unknown;
    usage?: { output_tokens?: number };
  };
};

const thinking = (txt: string, withUsage = false): Entry => ({
  type: "assistant",
  message: {
    content: [{ type: "thinking", thinking: txt }],
    ...(withUsage ? { usage: { output_tokens: 10 } } : {}),
  },
});

const assistantText = (txt: string, withUsage = false): Entry => ({
  type: "assistant",
  message: {
    content: [{ type: "text", text: txt }],
    ...(withUsage ? { usage: { output_tokens: 20 } } : {}),
  },
});

const user = (txt: string): Entry => ({
  type: "user",
  message: { content: [{ type: "text", text: txt }] },
});

describe("extractAssistantTextRange — issue #378", () => {
  it("collects text from later entries when the first usage-bearing entry is thinking-only", () => {
    const entries: Entry[] = [
      user("question"),
      thinking("internal", true),
      assistantText("Hello there.", true),
      assistantText(" Follow-up sentence.", true),
      user("next"),
    ];

    expect(extractAssistantTextRange(entries, 1, 4)).toBe(
      "Hello there.\n Follow-up sentence.",
    );
  });

  it("joins multiple text-bearing entries in JSONL order with newline", () => {
    const entries: Entry[] = [
      user("q"),
      assistantText("first chunk", true),
      assistantText("second chunk", true),
      assistantText("third chunk", true),
    ];

    expect(extractAssistantTextRange(entries, 1, entries.length)).toBe(
      "first chunk\nsecond chunk\nthird chunk",
    );
  });

  it("returns empty string when every assistant entry in range is thinking-only", () => {
    const entries: Entry[] = [
      user("q"),
      thinking("a", true),
      thinking("b", true),
      user("next"),
    ];

    expect(extractAssistantTextRange(entries, 1, 3)).toBe("");
  });

  it("ignores non-assistant entries inside the range", () => {
    const entries: Entry[] = [
      user("q"),
      assistantText("alpha", true),
      { type: "tool_result", message: { content: "ignored" } } as Entry,
      assistantText("beta", true),
    ];

    expect(extractAssistantTextRange(entries, 1, entries.length)).toBe(
      "alpha\nbeta",
    );
  });

  it("only pulls text blocks from a mixed-content entry — thinking blocks contribute nothing", () => {
    const mixed: Entry = {
      type: "assistant",
      message: {
        content: [
          { type: "thinking", thinking: "private" },
          { type: "text", text: "visible" },
        ],
        usage: { output_tokens: 5 },
      },
    };
    const entries: Entry[] = [user("q"), mixed];

    expect(extractAssistantTextRange(entries, 1, entries.length)).toBe(
      "visible",
    );
  });

  it("respects the endIdx boundary and skips entries past nextUserIdx", () => {
    const entries: Entry[] = [
      user("q1"),
      assistantText("turn-1 reply", true),
      user("q2"),
      assistantText("turn-2 reply — must NOT appear", true),
    ];

    expect(extractAssistantTextRange(entries, 1, 2)).toBe("turn-1 reply");
  });
});
