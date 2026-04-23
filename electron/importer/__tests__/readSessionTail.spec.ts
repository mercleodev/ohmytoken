/**
 * Regression test for #299.
 *
 * `importSinglePrompt` used to call `parseSessionFile(filePath)` which runs
 * `fs.readFileSync` over the entire JSONL. With 18 MB session files in active
 * projects, that blocked the Electron main thread for 300–500 ms on every
 * real-time import event (history entry or AssistantTurn).
 *
 * The fix reads only the tail window. These tests pin that behavior: the
 * leading partial line is discarded, small files stay whole-file equivalent,
 * and the tail read returns the recent entries that `importSinglePrompt`
 * actually needs.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { readSessionTailEntries } from "../historyImporter";

const makeUserLine = (id: string, text: string, ts: string): string =>
  JSON.stringify({
    type: "user",
    uuid: id,
    timestamp: ts,
    message: { content: text },
  }) + "\n";

const makeAssistantLine = (id: string, ts: string): string =>
  JSON.stringify({
    type: "assistant",
    uuid: id,
    timestamp: ts,
    message: {
      model: "claude-opus-4-7",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "ok" }],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
  }) + "\n";

describe("readSessionTailEntries (#299)", () => {
  let tmpDir = "";
  let filePath = "";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omt-tail-"));
    filePath = path.join(tmpDir, "session.jsonl");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns all entries when file is smaller than maxBytes", () => {
    const content =
      makeUserLine("u1", "hello", "2026-04-23T10:00:00.000Z") +
      makeAssistantLine("a1", "2026-04-23T10:00:01.000Z") +
      makeUserLine("u2", "world", "2026-04-23T10:00:02.000Z");
    fs.writeFileSync(filePath, content);

    const entries = readSessionTailEntries(filePath, 1024 * 1024);

    expect(entries).toHaveLength(3);
    expect(entries[0].uuid).toBe("u1");
    expect(entries[2].uuid).toBe("u2");
  });

  it("reads only the tail when file exceeds maxBytes, discarding the leading partial line", () => {
    // Build a large file: 200 filler lines + 3 tail lines.
    // Each filler user line is ~200 bytes, so 200 lines ≈ 40 KB.
    // We then request a 4 KB tail — that should cleanly land mid-file.
    const lines: string[] = [];
    for (let i = 0; i < 200; i++) {
      lines.push(
        makeUserLine(
          `filler-${i}`,
          `filler prompt number ${i} with padding xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`,
          "2026-04-23T09:00:00.000Z",
        ),
      );
    }
    lines.push(makeUserLine("tail-u1", "tail prompt", "2026-04-23T10:00:00.000Z"));
    lines.push(makeAssistantLine("tail-a1", "2026-04-23T10:00:01.000Z"));
    lines.push(makeUserLine("tail-u2", "next prompt", "2026-04-23T10:00:02.000Z"));
    fs.writeFileSync(filePath, lines.join(""));

    const entries = readSessionTailEntries(filePath, 4 * 1024);

    // Partial leading line must be dropped — no entry should have a parse-broken shape.
    for (const e of entries) {
      expect(e).toHaveProperty("type");
    }
    // The tail entries MUST be present (they sit at EOF).
    const uuids = entries.map((e) => e.uuid);
    expect(uuids).toContain("tail-u1");
    expect(uuids).toContain("tail-a1");
    expect(uuids).toContain("tail-u2");
    // And we must not have read from the very start of the file.
    expect(uuids).not.toContain("filler-0");
  });

  it("handles a tail window that lands exactly on a newline boundary (no partial line to discard)", () => {
    // Two whole lines. Request a window sized to exactly the second line + newline.
    const l1 = makeUserLine("u1", "first", "2026-04-23T10:00:00.000Z");
    const l2 = makeUserLine("u2", "second", "2026-04-23T10:00:01.000Z");
    fs.writeFileSync(filePath, l1 + l2);

    const entries = readSessionTailEntries(filePath, Buffer.byteLength(l2));

    // Only the second line fits → first line is implicitly cut off.
    // The tail reader should NOT return a corrupt entry from the cut.
    for (const e of entries) {
      expect(e).toHaveProperty("uuid");
    }
    expect(entries.map((e) => e.uuid)).toContain("u2");
  });

  it("returns empty array when the file does not exist", () => {
    const entries = readSessionTailEntries(
      path.join(tmpDir, "missing.jsonl"),
      1024,
    );
    expect(entries).toEqual([]);
  });

  it("returns empty array when the file is empty", () => {
    fs.writeFileSync(filePath, "");
    const entries = readSessionTailEntries(filePath, 1024);
    expect(entries).toEqual([]);
  });

  it("skips malformed lines without throwing", () => {
    const content =
      "this is not json\n" +
      makeUserLine("u1", "valid", "2026-04-23T10:00:00.000Z") +
      "{broken json\n" +
      makeAssistantLine("a1", "2026-04-23T10:00:01.000Z");
    fs.writeFileSync(filePath, content);

    const entries = readSessionTailEntries(filePath, 1024 * 1024);

    expect(entries.map((e) => e.uuid)).toEqual(["u1", "a1"]);
  });
});
