// P1-3 sanity (gate doc §8). Drives a real SSE response through the
// production proxy → mock upstream loop and asserts the record-usage
// helpers fire with the right shape. Side-effect modules (writeUsageLog,
// writeScanLog, scanBuilder) are mocked because the wiring under test is
// the proxy → record-helper hop, not the disk pipeline.
//
// Phase 1 retrospective review (#301) — proxy/server.ts now calls
// recordClaudeUsageDelta / recordClaudeUsageFinal (which own both the
// wire emit and the sessionState accumulator update) instead of reaching
// into both modules separately. The unit-level emit / accumulator shape
// is owned by claudeProxyEmit.spec.ts; this integration only asserts the
// proxy hands the right payload to the record helpers.

import * as http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../eventBus/providers/claudeProxyEmit", () => ({
  emitClaudeProxyMessageDelta: vi.fn(),
  emitClaudeProxyMessageStop: vi.fn(),
  recordClaudeUsageDelta: vi.fn(),
  recordClaudeUsageFinal: vi.fn(),
}));
vi.mock("../usageWriter", () => ({ writeUsageLog: vi.fn() }));
vi.mock("../scanWriter", () => ({ writeScanLog: vi.fn() }));
vi.mock("../scanBuilder", () => ({ buildPromptScan: vi.fn(() => null) }));

import {
  recordClaudeUsageDelta,
  recordClaudeUsageFinal,
} from "../../eventBus/providers/claudeProxyEmit";
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
    vi.mocked(recordClaudeUsageDelta).mockClear();
    vi.mocked(recordClaudeUsageFinal).mockClear();
  });

  afterEach(async () => {
    await stopProxyServer();
    await new Promise<void>((resolve) =>
      mockUpstream.server.close(() => resolve()),
    );
  });

  it("calls recordClaudeUsageDelta per SSE delta + recordClaudeUsageFinal once on stop, with monotonic delta tokens", async () => {
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

    expect(recordClaudeUsageDelta).toHaveBeenCalledTimes(2);
    expect(recordClaudeUsageFinal).toHaveBeenCalledTimes(1);

    const delta1 = vi.mocked(recordClaudeUsageDelta).mock.calls[0][0];
    expect(delta1.deltaOutputTokens).toBe(30);
    expect(delta1.cumulativeOutputTokens).toBe(30);
    expect(delta1.cumulativeCostUsd).toBeGreaterThanOrEqual(0);
    expect(delta1.deltaCostUsd).toBeGreaterThanOrEqual(0);
    expect(delta1.requestId).toMatch(/[0-9a-f-]{36}/);
    expect(typeof delta1.sessionId).toBe("string");

    const delta2 = vi.mocked(recordClaudeUsageDelta).mock.calls[1][0];
    expect(delta2.deltaOutputTokens).toBe(20); // 50 - 30
    expect(delta2.cumulativeOutputTokens).toBe(50);
    expect(delta2.requestId).toBe(delta1.requestId);
    expect(delta2.sessionId).toBe(delta1.sessionId);

    const stop = vi.mocked(recordClaudeUsageFinal).mock.calls[0][0];
    expect(stop.finalOutputTokens).toBe(50);
    expect(stop.finalCostUsd).toBeGreaterThanOrEqual(delta2.cumulativeCostUsd);
    expect(stop.requestId).toBe(delta1.requestId);
    expect(stop.sessionId).toBe(delta1.sessionId);
    expect(stop.topUpOutputTokens).toBe(0); // last delta already at 50

    // The token-delta sum across the helpers must equal the final
    // cumulative_output_tokens so the accumulator inside the helpers can
    // never drift above ground truth.
    const tokenSumFromDeltas = vi
      .mocked(recordClaudeUsageDelta)
      .mock.calls.reduce((sum, [args]) => sum + args.deltaOutputTokens, 0);
    const tokenSumFromFinal = vi
      .mocked(recordClaudeUsageFinal)
      .mock.calls.reduce((sum, [args]) => sum + args.topUpOutputTokens, 0);
    expect(tokenSumFromDeltas + tokenSumFromFinal).toBe(50);
  });

  it("does not call any usage recorder on non-/v1/messages traffic", async () => {
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

    expect(recordClaudeUsageDelta).not.toHaveBeenCalled();
    expect(recordClaudeUsageFinal).not.toHaveBeenCalled();
  });
});
