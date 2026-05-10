import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { handleScanFromTranscriptRequest } from "../scanFromTranscriptHandler";

const TRANSCRIPT = path.join(__dirname, "fixtures", "minimal-session.jsonl");
const GLOBAL_CLAUDE_MD = path.join(
  os.tmpdir(),
  `oht-test-handler-global-claude-${process.pid}-${Date.now()}.md`,
);

beforeAll(() => {
  fs.writeFileSync(
    GLOBAL_CLAUDE_MD,
    "# Global Preferences (Fixture)\n\n- Sample.\n",
  );
});

afterAll(() => {
  try {
    fs.unlinkSync(GLOBAL_CLAUDE_MD);
  } catch {
    /* ignore */
  }
});

describe("handleScanFromTranscriptRequest", () => {
  it("returns 400 when body is not valid JSON", () => {
    const writeHookScan = vi.fn();
    const out = handleScanFromTranscriptRequest("not-json", { writeHookScan });
    expect(out.status).toBe(400);
    expect(writeHookScan).not.toHaveBeenCalled();
  });

  it("returns 400 when transcript_path is missing", () => {
    const writeHookScan = vi.fn();
    const out = handleScanFromTranscriptRequest(
      JSON.stringify({ session_id: "s1" }),
      { writeHookScan },
    );
    expect(out.status).toBe(400);
    expect(writeHookScan).not.toHaveBeenCalled();
  });

  it("returns 404 when the transcript file cannot be read or has no assistant turn", () => {
    const writeHookScan = vi.fn();
    const out = handleScanFromTranscriptRequest(
      JSON.stringify({
        session_id: "s1",
        transcript_path: "/tmp/oht-hook-fixture-missing.jsonl",
      }),
      { writeHookScan },
    );
    expect(out.status).toBe(404);
    expect(writeHookScan).not.toHaveBeenCalled();
  });

  it("on success: invokes writeHookScan with the merged scan + usage and returns 200", () => {
    const writeHookScan = vi.fn();
    const out = handleScanFromTranscriptRequest(
      JSON.stringify({
        session_id: "session-from-body",
        transcript_path: TRANSCRIPT,
      }),
      { writeHookScan, globalClaudeMdPath: GLOBAL_CLAUDE_MD },
    );

    expect(out.status).toBe(200);
    expect(JSON.parse(out.body).ok).toBe(true);

    expect(writeHookScan).toHaveBeenCalledTimes(1);
    const [scanArg, usageArg] = writeHookScan.mock.calls[0];

    expect(scanArg.session_id).toBe("session-from-body");
    expect(scanArg.user_prompt).toBe("hello from fixture");
    expect(
      scanArg.injected_files.find((f: { category: string }) => f.category === "global"),
    ).toBeDefined();
    expect(
      scanArg.injected_files.find((f: { category: string }) => f.category === "project"),
    ).toBeDefined();

    expect(usageArg.response.input_tokens).toBe(10);
    expect(usageArg.response.output_tokens).toBe(5);
    expect(usageArg.session_id).toBe("session-from-body");
  });

  it("uses the session_id from the transcript when the body does not provide one", () => {
    const writeHookScan = vi.fn();
    const out = handleScanFromTranscriptRequest(
      JSON.stringify({ transcript_path: TRANSCRIPT }),
      { writeHookScan, globalClaudeMdPath: GLOBAL_CLAUDE_MD },
    );
    expect(out.status).toBe(200);
    const [scanArg] = writeHookScan.mock.calls[0];
    expect(scanArg.session_id).toBe("session-abc");
  });

  it("returns 500 if the writer throws", () => {
    const writeHookScan = vi.fn(() => {
      throw new Error("db down");
    });
    const out = handleScanFromTranscriptRequest(
      JSON.stringify({ transcript_path: TRANSCRIPT }),
      { writeHookScan, globalClaudeMdPath: GLOBAL_CLAUDE_MD },
    );
    expect(out.status).toBe(500);
  });
});
