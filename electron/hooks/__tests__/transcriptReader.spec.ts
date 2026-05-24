import { describe, it, expect } from "vitest";
import path from "node:path";
import { readLatestTurn } from "../transcriptReader";

const FIXTURE = path.join(__dirname, "fixtures", "minimal-session.jsonl");

describe("readLatestTurn", () => {
  it("returns null when transcript path does not exist", () => {
    expect(readLatestTurn("/tmp/oht-hook-fixture-does-not-exist.jsonl")).toBeNull();
  });

  it("extracts user prompt, assistant text, model, usage, nested_memory and session metadata from the latest turn", () => {
    const t = readLatestTurn(FIXTURE);
    expect(t).not.toBeNull();

    expect(t!.session_id).toBe("session-abc");
    expect(t!.cwd).toBe("/tmp/fixture-app");
    expect(t!.git_branch).toBe("main");

    expect(t!.user_message_text).toBe("hello from fixture");
    expect(t!.assistant_message_text).toBe("Hi there.");
    expect(t!.model).toBe("claude-test-model");

    expect(t!.usage.input_tokens).toBe(10);
    expect(t!.usage.output_tokens).toBe(5);
    expect(t!.usage.cache_creation_input_tokens).toBe(0);
    expect(t!.usage.cache_read_input_tokens).toBe(0);

    expect(t!.nested_memories).toHaveLength(1);
    expect(t!.nested_memories[0].path).toBe("/tmp/fixture-app/CLAUDE.md");
    expect(t!.nested_memories[0].type).toBe("Project");
    expect(t!.nested_memories[0].content).toContain("# Fixture");

    expect(t!.assistant_timestamp).toBe("2030-01-01T00:00:00.030Z");
    expect(t!.request_id).toBe("req-1");
  });

  // Issue #367: capture parity — the user message UUID from the JSONL is the
  // canonical turn identifier shared by the history-import path
  // (`importSinglePrompt`) and the hook path. Exposing it on TranscriptTurn lets
  // `scanFromTranscript` align its request_id with the import path so the same
  // turn produces a single `prompts` row regardless of which capture path
  // detects it first.
  it("exposes the user message uuid from the ancestry as user_uuid", () => {
    const t = readLatestTurn(FIXTURE);
    expect(t).not.toBeNull();
    expect(t!.user_uuid).toBe("u-1");
  });
});
