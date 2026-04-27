// P1-3 sanity (gate doc §8). Drives a real SSE response through the
// production proxy → mock upstream loop and asserts the message_delta /
// message_stop emit helpers fire with the right shape. Side-effect
// modules (writeUsageLog, writeScanLog, scanBuilder) are mocked because
// the wiring under test is the emit hop, not the disk pipeline.

import * as http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../eventBus/providers/claudeProxyEmit", () => ({
  emitClaudeProxyMessageDelta: vi.fn(),
  emitClaudeProxyMessageStop: vi.fn(),
}));
// P1-5: accumulator is wired next to the emit helpers in
// processSseEvents. The integration test owns emit-shape assertions —
// running totals are covered in sessionState.spec.ts — so we mock the
// accumulator here to keep this suite focused on the proxy → emit hop.
vi.mock("../../eventBus/sessionState", () => ({
  accumulateActiveSessionTokens: vi.fn(),
}));
vi.mock("../usageWriter", () => ({ writeUsageLog: vi.fn() }));
vi.mock("../scanWriter", () => ({ writeScanLog: vi.fn() }));
vi.mock("../scanBuilder", () => ({ buildPromptScan: vi.fn(() => null) }));

import {
  emitClaudeProxyMessageDelta,
  emitClaudeProxyMessageStop,
} from "../../eventBus/providers/claudeProxyEmit";
import { accumulateActiveSessionTokens } from "../../eventBus/sessionState";
import { startProxyServer, stopProxyServer } from "../server";

const sseFrame = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const MOCK_FRAMES = [
  sseFrame("message_start", {
    type: "message_start",
    message: {
      usage: {
        input_tokens: 1000,
        cache_creation_input_tokens: 100,
        cache_read_input_tokens: 50,
      },
    },
  }),
  sseFrame("message_delta", {
    type: "message_delta",
    usage: { output_tokens: 30 },
  }),
  sseFrame("message_delta", {
    type: "message_delta",
    usage: { output_tokens: 50 },
  }),
  sseFrame("message_stop", { type: "message_stop" }),
];

const startMockUpstream = (): Promise<{
  server: http.Server;
  port: number;
}> =>
  new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/v1/messages") {
        req.on("data", () => {
          /* drain — request body is not inspected by the mock */
        });
        req.on("end", () => {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          });
          for (const frame of MOCK_FRAMES) {
            res.write(frame);
          }
          res.end();
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve({ server, port: addr.port });
      } else {
        reject(new Error("mock upstream: could not determine port"));
      }
    });
  });

const startProxyOnRandomPort = (upstream: string): Promise<{ port: number }> =>
  new Promise((resolve, reject) => {
    const server = startProxyServer({ port: 0, upstream });
    server.once("listening", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        resolve({ port: addr.port });
      } else {
        reject(new Error("proxy: could not determine port"));
      }
    });
    server.once("error", reject);
  });

const postToProxy = (port: number, body: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        res.on("data", () => {
          /* drain — we only care about the upstream-driven side effects */
        });
        res.on("end", () => resolve());
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });

describe("proxy server.ts — emit wiring (P1-3 integration)", () => {
  let mockUpstream: { server: http.Server; port: number };

  beforeEach(async () => {
    await stopProxyServer();
    mockUpstream = await startMockUpstream();
    vi.mocked(emitClaudeProxyMessageDelta).mockClear();
    vi.mocked(emitClaudeProxyMessageStop).mockClear();
    vi.mocked(accumulateActiveSessionTokens).mockClear();
  });

  afterEach(async () => {
    await stopProxyServer();
    await new Promise<void>((resolve) =>
      mockUpstream.server.close(() => resolve()),
    );
  });

  it("emits message_delta per SSE delta + message_stop once on stop, with monotonic delta tokens", async () => {
    const proxy = await startProxyOnRandomPort(
      `127.0.0.1:${mockUpstream.port}`,
    );
    await postToProxy(
      proxy.port,
      JSON.stringify({
        model: "claude-opus-4-6-20250514",
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      }),
    );

    // Flush event loop so the proxy's response 'end' handler runs.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(emitClaudeProxyMessageDelta).toHaveBeenCalledTimes(2);
    expect(emitClaudeProxyMessageStop).toHaveBeenCalledTimes(1);

    const delta1 = vi.mocked(emitClaudeProxyMessageDelta).mock.calls[0][0];
    expect(delta1.deltaOutputTokens).toBe(30);
    expect(delta1.cumulativeOutputTokens).toBe(30);
    expect(delta1.cumulativeCostUsd).toBeGreaterThanOrEqual(0);
    expect(delta1.requestId).toMatch(/[0-9a-f-]{36}/);

    const delta2 = vi.mocked(emitClaudeProxyMessageDelta).mock.calls[1][0];
    expect(delta2.deltaOutputTokens).toBe(20); // 50 - 30
    expect(delta2.cumulativeOutputTokens).toBe(50);
    expect(delta2.requestId).toBe(delta1.requestId);

    const stop = vi.mocked(emitClaudeProxyMessageStop).mock.calls[0][0];
    expect(stop.finalOutputTokens).toBe(50);
    expect(stop.finalCostUsd).toBeGreaterThanOrEqual(delta2.cumulativeCostUsd);
    expect(stop.requestId).toBe(delta1.requestId);

    // P1-5: accumulator is invoked alongside each emit (2 deltas + 1
    // stop = 3 calls). The token-delta sum across the calls must equal
    // the final cumulative_output_tokens so sessionState totals can
    // never drift above ground truth.
    const accumulatorCalls = vi.mocked(accumulateActiveSessionTokens).mock
      .calls;
    expect(accumulatorCalls).toHaveLength(3);
    const tokenSum = accumulatorCalls.reduce(
      (sum, [args]) => sum + args.output_tokens_delta,
      0,
    );
    expect(tokenSum).toBe(50);
    const sessionIds = new Set(accumulatorCalls.map(([args]) => args.session_id));
    expect(sessionIds.size).toBe(1); // single session id across the request
  });

  it("does not emit on non-/v1/messages traffic", async () => {
    const proxy = await startProxyOnRandomPort(
      `127.0.0.1:${mockUpstream.port}`,
    );
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: proxy.port,
          path: "/v1/something-else",
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
        (res) => {
          res.on("data", () => {});
          res.on("end", () => resolve());
          res.on("error", reject);
        },
      );
      req.on("error", reject);
      req.write("{}");
      req.end();
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(emitClaudeProxyMessageDelta).not.toHaveBeenCalled();
    expect(emitClaudeProxyMessageStop).not.toHaveBeenCalled();
    expect(accumulateActiveSessionTokens).not.toHaveBeenCalled();
  });
});
