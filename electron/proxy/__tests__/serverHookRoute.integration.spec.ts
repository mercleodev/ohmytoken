// Integration test for the `POST /api/scan/from-transcript` route registered
// by the proxy server (issue #343, captured 2026-05-10). The route must fire
// the injected `onHookScanComplete` callback with a fully built PromptScan
// (project + global injected files) and Anthropic-reported usage from the
// transcript JSONL — without forwarding to the upstream proxy. Side-effect
// writers (writeScanLog, writeUsageLog) are mocked because the wiring under
// test is route → handler → callback, not the disk pipeline.

import * as http from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  __dirname,
  "..",
  "..",
  "hooks",
  "__tests__",
  "fixtures",
  "global-CLAUDE.md",
);

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

  beforeEach(async () => {
    onHookScanComplete.mockReset();
    server = startProxyServer({
      port: 0,
      upstream: "127.0.0.1:1", // unreachable; route never forwards anyway
      globalClaudeMdPath: GLOBAL_CLAUDE_MD,
      onHookScanComplete,
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

  it("returns 400 for invalid JSON without invoking the callback", async () => {
    const res = await post(port, "not-json");
    expect(res.status).toBe(400);
    expect(onHookScanComplete).not.toHaveBeenCalled();
  });

  it("returns 404 when the transcript file is missing", async () => {
    const res = await post(
      port,
      JSON.stringify({ transcript_path: "/tmp/oht-hook-fixture-missing-2.jsonl" }),
    );
    expect(res.status).toBe(404);
    expect(onHookScanComplete).not.toHaveBeenCalled();
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
  });
});
