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
  // Fast settle for static fixture files (no growth happening).
  const FAST_SETTLE = { intervalMs: 10, stableForMs: 20, maxWaitMs: 200 };

  it("returns 400 when body is not valid JSON", async () => {
    const writeHookScan = vi.fn();
    const out = await handleScanFromTranscriptRequest("not-json", {
      writeHookScan,
      settleOptions: FAST_SETTLE,
    });
    expect(out.status).toBe(400);
    expect(writeHookScan).not.toHaveBeenCalled();
  });

  it("returns 400 when transcript_path is missing", async () => {
    const writeHookScan = vi.fn();
    const out = await handleScanFromTranscriptRequest(
      JSON.stringify({ session_id: "s1" }),
      { writeHookScan, settleOptions: FAST_SETTLE },
    );
    expect(out.status).toBe(400);
    expect(writeHookScan).not.toHaveBeenCalled();
  });

  it("returns 404 when the transcript file cannot be read or has no assistant turn", async () => {
    const writeHookScan = vi.fn();
    const out = await handleScanFromTranscriptRequest(
      JSON.stringify({
        session_id: "s1",
        transcript_path: "/tmp/oht-hook-fixture-missing.jsonl",
      }),
      { writeHookScan, settleOptions: FAST_SETTLE },
    );
    expect(out.status).toBe(404);
    expect(writeHookScan).not.toHaveBeenCalled();
  });

  it("on success: invokes writeHookScan with the merged scan + usage and returns 200", async () => {
    const writeHookScan = vi.fn();
    const out = await handleScanFromTranscriptRequest(
      JSON.stringify({
        session_id: "session-from-body",
        transcript_path: TRANSCRIPT,
      }),
      {
        writeHookScan,
        globalClaudeMdPath: GLOBAL_CLAUDE_MD,
        settleOptions: FAST_SETTLE,
      },
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

  it("uses the session_id from the transcript when the body does not provide one", async () => {
    const writeHookScan = vi.fn();
    const out = await handleScanFromTranscriptRequest(
      JSON.stringify({ transcript_path: TRANSCRIPT }),
      {
        writeHookScan,
        globalClaudeMdPath: GLOBAL_CLAUDE_MD,
        settleOptions: FAST_SETTLE,
      },
    );
    expect(out.status).toBe(200);
    const [scanArg] = writeHookScan.mock.calls[0];
    expect(scanArg.session_id).toBe("session-abc");
  });

  it(
    "outlasts a growing JSONL: appends made DURING handler execution are reflected in the final scan (#349 race)",
    async () => {
      const growingPath = path.join(
        os.tmpdir(),
        `oht-test-race-${process.pid}-${Date.now()}.jsonl`,
      );
      // T0: file is in the "Stop fired but final flush not done" state —
      // only an intermediate empty-text assistant (mimics L31 in the live
      // capture from issue #349).
      const partialLines = [
        {
          parentUuid: null,
          isSidechain: false,
          promptId: "p-0",
          type: "user",
          message: { role: "user", content: "first prompt" },
          uuid: "u-0",
          timestamp: "2030-01-01T00:00:00.000Z",
          cwd: "/tmp/race-fixture",
          sessionId: "race-session",
          gitBranch: "main",
          version: "2.1.119",
        },
        {
          parentUuid: "u-0",
          isSidechain: false,
          requestId: "req-INTERMEDIATE",
          type: "assistant",
          message: {
            model: "claude-test",
            role: "assistant",
            content: [{ type: "tool_use", id: "t-0", name: "Bash", input: {} }],
            usage: { input_tokens: 1, output_tokens: 0 },
          },
          uuid: "u-1",
          timestamp: "2030-01-01T00:00:01.000Z",
          cwd: "/tmp/race-fixture",
          sessionId: "race-session",
          gitBranch: "main",
          version: "2.1.119",
        },
      ];
      fs.writeFileSync(
        growingPath,
        partialLines.map((l) => JSON.stringify(l)).join("\n") + "\n",
      );

      // T1: schedule the "late" writes that the runner flushes AFTER the
      // Stop hook fired — a user prompt for the cycle, a nested_memory
      // attachment for project CLAUDE.md, and the final text assistant
      // with the real request_id.
      setTimeout(() => {
        const next = [
          {
            parentUuid: "u-1",
            type: "user",
            message: { role: "user", content: "what rules exist?" },
            uuid: "u-2",
            timestamp: "2030-01-01T00:00:02.000Z",
            cwd: "/tmp/race-fixture",
            sessionId: "race-session",
            version: "2.1.119",
          },
          {
            parentUuid: "u-2",
            type: "attachment",
            attachment: {
              type: "nested_memory",
              path: "/tmp/race-fixture/CLAUDE.md",
              content: {
                path: "/tmp/race-fixture/CLAUDE.md",
                type: "Project",
                content: "# Project rules\n\nuse 2-space indent.\n",
              },
            },
            uuid: "u-3",
            timestamp: "2030-01-01T00:00:02.100Z",
            cwd: "/tmp/race-fixture",
            sessionId: "race-session",
            version: "2.1.119",
          },
          {
            parentUuid: "u-3",
            requestId: "req-FINAL",
            type: "assistant",
            message: {
              model: "claude-test",
              role: "assistant",
              content: [{ type: "text", text: "Two rules apply." }],
              usage: { input_tokens: 3, output_tokens: 7 },
            },
            uuid: "u-4",
            timestamp: "2030-01-01T00:00:03.000Z",
            cwd: "/tmp/race-fixture",
            sessionId: "race-session",
            version: "2.1.119",
          },
        ];
        fs.appendFileSync(
          growingPath,
          next.map((l) => JSON.stringify(l)).join("\n") + "\n",
        );
      }, 60);

      try {
        const writeHookScan = vi.fn();
        const out = await handleScanFromTranscriptRequest(
          JSON.stringify({ transcript_path: growingPath }),
          {
            writeHookScan,
            globalClaudeMdPath: GLOBAL_CLAUDE_MD,
            // Settle window must outlast the 60ms scheduled append.
            settleOptions: { intervalMs: 25, stableForMs: 80, maxWaitMs: 1000 },
          },
        );

        expect(out.status).toBe(200);
        expect(writeHookScan).toHaveBeenCalledTimes(1);
        const [scan] = writeHookScan.mock.calls[0];

        // The final flushed assistant's request_id, not the intermediate.
        expect(scan.request_id).toBe("req-FINAL");
        expect(scan.assistant_response).toBe("Two rules apply.");
        // Project nested_memory must be captured (only visible after the append).
        const project = scan.injected_files.find(
          (f: { category: string }) => f.category === "project",
        );
        expect(project).toBeDefined();
        expect(project!.path).toBe("/tmp/race-fixture/CLAUDE.md");
        // Global CLAUDE.md still picked up via filesystem read.
        expect(
          scan.injected_files.find(
            (f: { category: string }) => f.category === "global",
          ),
        ).toBeDefined();
      } finally {
        try {
          fs.unlinkSync(growingPath);
        } catch {
          /* ignore */
        }
      }
    },
    10_000,
  );

  it("returns 500 if the writer throws", async () => {
    const writeHookScan = vi.fn(() => {
      throw new Error("db down");
    });
    const out = await handleScanFromTranscriptRequest(
      JSON.stringify({ transcript_path: TRANSCRIPT }),
      {
        writeHookScan,
        globalClaudeMdPath: GLOBAL_CLAUDE_MD,
        settleOptions: FAST_SETTLE,
      },
    );
    expect(out.status).toBe(500);
  });
});
