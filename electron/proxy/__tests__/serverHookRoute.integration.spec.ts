// Integration test for the `POST /api/scan/from-transcript` route registered
// by the proxy server (issue #343, captured 2026-05-10). The route must fire
// the injected `onHookScanComplete` callback with a fully built PromptScan
// (project + global injected files) and Anthropic-reported usage from the
// transcript JSONL — without forwarding to the upstream proxy. Side-effect
// writers (writeScanLog, writeUsageLog) are mocked because the wiring under
// test is route → handler → callback, not the disk pipeline.

import * as http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("../scanWriter", () => ({ writeScanLog: vi.fn() }));
vi.mock("../usageWriter", () => ({ writeUsageLog: vi.fn() }));

import { startProxyServer, stopProxyServer } from "../server";

const TRANSCRIPT = path.join(
  __dirname,
  "..",
  "..",
  "hooks",
  "__tests__",
  "fixtures",
  "minimal-session.jsonl",
);
const GLOBAL_CLAUDE_MD = path.join(
  os.tmpdir(),
  `oht-test-route-global-claude-${process.pid}-${Date.now()}.md`,
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

const post = (
  port: number,
  body: string,
  pathname = "/api/scan/from-transcript",
): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: pathname,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c.toString("utf-8")));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: buf }));
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });

describe("proxy server: POST /api/scan/from-transcript", () => {
  let server: http.Server | null = null;
  let port = 0;
  const onHookScanComplete = vi.fn();
  const onHookScanScored = vi.fn();

  beforeEach(async () => {
    onHookScanComplete.mockReset();
    onHookScanScored.mockReset();
    server = startProxyServer({
      port: 0,
      upstream: "127.0.0.1:1", // unreachable; route never forwards anyway
      globalClaudeMdPath: GLOBAL_CLAUDE_MD,
      onHookScanComplete,
      onHookScanScored,
    });
    await new Promise<void>((resolve) => {
      server!.once("listening", () => {
        const addr = server!.address();
        if (addr && typeof addr === "object") port = addr.port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await stopProxyServer();
    server = null;
  });

  it("invokes onHookScanComplete with the parsed scan + usage and returns 200", async () => {
    const res = await post(
      port,
      JSON.stringify({ session_id: "sess-x", transcript_path: TRANSCRIPT }),
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    expect(onHookScanComplete).toHaveBeenCalledTimes(1);
    const [scan, usage] = onHookScanComplete.mock.calls[0];
    expect(scan.session_id).toBe("sess-x");
    expect(scan.user_prompt).toBe("hello from fixture");
    expect(scan.injected_files.length).toBeGreaterThanOrEqual(2);
    expect(usage.response.input_tokens).toBe(10);
    expect(usage.response.output_tokens).toBe(5);
  });

  // Issue #365: hook path must trigger evidence scoring like the SessionFile
  // and History watcher paths do — otherwise hook-source prompts land in the
  // dashboard with 0 confirmed/likely/unverified rows.
  it("fires onHookScanScored with the scan's request_id after a successful write", async () => {
    const res = await post(
      port,
      JSON.stringify({ session_id: "sess-x", transcript_path: TRANSCRIPT }),
    );
    expect(res.status).toBe(200);
    expect(onHookScanScored).toHaveBeenCalledTimes(1);
    const [scoredRequestId] = onHookScanScored.mock.calls[0];
    // The fixture sets request_id via the assistant entry's requestId field.
    const [scan] = onHookScanComplete.mock.calls[0];
    expect(scoredRequestId).toBe(scan.request_id);
  });

  it("does not fire onHookScanScored when the scan write throws", async () => {
    onHookScanComplete.mockImplementationOnce(() => {
      throw new Error("simulated db write failure");
    });
    const res = await post(
      port,
      JSON.stringify({ session_id: "sess-x", transcript_path: TRANSCRIPT }),
    );
    // The handler still returns 500 for write errors but must not trigger
    // scoring on a half-written prompt.
    expect(res.status).toBe(500);
    expect(onHookScanScored).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON without invoking either callback", async () => {
    const res = await post(port, "not-json");
    expect(res.status).toBe(400);
    expect(onHookScanComplete).not.toHaveBeenCalled();
    expect(onHookScanScored).not.toHaveBeenCalled();
  });

  it("returns 404 when the transcript file is missing", async () => {
    const res = await post(
      port,
      JSON.stringify({ transcript_path: "/tmp/oht-hook-fixture-missing-2.jsonl" }),
    );
    expect(res.status).toBe(404);
    expect(onHookScanComplete).not.toHaveBeenCalled();
    expect(onHookScanScored).not.toHaveBeenCalled();
  });

  it("does not intercept GET requests to the same path (falls through to forwarding)", async () => {
    // Forwarding to 127.0.0.1:1 will fail with bad gateway — that proves
    // the route handler did NOT short-circuit.
    const res = await new Promise<{ status: number }>((resolve, reject) => {
      http
        .get(
          { host: "127.0.0.1", port, path: "/api/scan/from-transcript" },
          (r) => {
            r.on("data", () => {});
            r.on("end", () => resolve({ status: r.statusCode || 0 }));
          },
        )
        .on("error", reject);
    });
    expect(res.status).toBe(502);
    expect(onHookScanComplete).not.toHaveBeenCalled();
    expect(onHookScanScored).not.toHaveBeenCalled();
  });
});
