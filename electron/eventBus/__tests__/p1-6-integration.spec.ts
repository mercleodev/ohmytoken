// P1-6 integration sanity (gate doc §8 + §8.1). Drives the live wiring
// end-to-end inside vitest:
//
//   setActiveSession  →  accumulateActiveSessionTokens (×N)
//                                |
//                                ▼
//                       getActiveSnapshot
//                                |
//                                ▼
//                  EventBusServer.start() → ws snapshot frame
//
// The unit suites (`sessionState.spec.ts`, `statusline.spec.ts`) cover
// each hop in isolation. This spec proves the end-to-end shape: a
// subscriber that connects after N accumulator calls receives a
// snapshot frame whose `current_session` carries the cumulative token +
// cost totals — i.e. exactly what the P1-6 statusline reader will
// render. The mandatory full-stack Electron headed run (§2 gate,
// `.claude/rules/agent-browser-qa.md`) still verifies the *real*
// proxy → DB → tray path under the agent-browser harness; this vitest
// spec is the strongest deterministic evidence we can produce without
// a GUI process.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { bindEventBusServer, resetEventBusClient } from "../client";
import { createEventBusServer, type EventBusServer } from "../server";
import {
  accumulateActiveSessionTokens,
  getActiveSnapshot,
  resetSessionState,
  setActiveSession,
} from "../sessionState";

const SESSION_ID = "sess-p1-6-integration";

async function startBoundServer(): Promise<EventBusServer> {
  resetSessionState();
  resetEventBusClient();
  const server = createEventBusServer({
    port: 0,
    getSnapshot: getActiveSnapshot,
  });
  await server.start();
  bindEventBusServer(server);
  return server;
}

async function waitFor<T>(
  predicate: () => T | undefined,
  timeoutMs = 1000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = predicate();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

interface SnapshotFrame {
  op: "snapshot";
  current_session: {
    provider: string;
    session_id: string;
    ctx_estimate: number;
    output_tokens_total?: number;
    cost_usd_total?: number;
  } | null;
}

async function captureSnapshot(port: number): Promise<SnapshotFrame> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const frames: Array<Record<string, unknown>> = [];
  ws.on("message", (raw) => {
    frames.push(JSON.parse(raw.toString()) as Record<string, unknown>);
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  ws.send(JSON.stringify({ op: "subscribe", types: ["*"] }));
  const snap = await waitFor(() => frames.find((f) => f.op === "snapshot"));
  ws.close();
  return snap as unknown as SnapshotFrame;
}

describe("P1-6 statusline-bus integration", () => {
  let server: EventBusServer;

  beforeEach(async () => {
    server = await startBoundServer();
  });

  afterEach(async () => {
    bindEventBusServer(null);
    await server.stop();
    resetSessionState();
  });

  it("a snapshot taken after N accumulator calls carries the live cumulative totals", async () => {
    setActiveSession({
      provider: "claude",
      session_id: SESSION_ID,
      ctx_estimate: 0,
    });

    // Simulate the proxy emit-site driving the accumulator across an
    // SSE response: 3 deltas with growing token counts + non-trivial
    // cost increments. The accumulator is the same code path the proxy
    // calls (gate doc §8 P1-5 option A); this drives it directly to
    // avoid spinning up the proxy server in this suite.
    accumulateActiveSessionTokens({
      session_id: SESSION_ID,
      output_tokens_delta: 30,
      cost_usd_delta: 0.0007,
    });
    accumulateActiveSessionTokens({
      session_id: SESSION_ID,
      output_tokens_delta: 20,
      cost_usd_delta: 0.0005,
    });
    accumulateActiveSessionTokens({
      session_id: SESSION_ID,
      output_tokens_delta: 100,
      cost_usd_delta: 0.0023,
    });

    const snap = await captureSnapshot(server.port);
    expect(snap).toMatchObject({
      op: "snapshot",
      current_session: {
        provider: "claude",
        session_id: SESSION_ID,
        output_tokens_total: 150,
      },
    });
    // Cost is float — guard against fp drift: 0.0007 + 0.0005 + 0.0023.
    expect(snap.current_session?.cost_usd_total).toBeCloseTo(0.0035, 6);
  });

  it("subscribers that connect mid-stream see the in-progress totals", async () => {
    setActiveSession({
      provider: "claude",
      session_id: SESSION_ID,
      ctx_estimate: 0,
    });

    // Two events arrive before the subscriber is up.
    accumulateActiveSessionTokens({
      session_id: SESSION_ID,
      output_tokens_delta: 70,
      cost_usd_delta: 0.001,
    });
    accumulateActiveSessionTokens({
      session_id: SESSION_ID,
      output_tokens_delta: 30,
      cost_usd_delta: 0.0008,
    });

    // Late subscriber connects → snapshot must reflect both.
    const snap1 = await captureSnapshot(server.port);
    expect(snap1.current_session).toMatchObject({
      output_tokens_total: 100,
    });
    expect(snap1.current_session?.cost_usd_total).toBeCloseTo(0.0018, 6);

    // One more event lands; a *new* subscriber sees the post-event totals.
    accumulateActiveSessionTokens({
      session_id: SESSION_ID,
      output_tokens_delta: 50,
      cost_usd_delta: 0.0012,
    });
    const snap2 = await captureSnapshot(server.port);
    expect(snap2.current_session).toMatchObject({
      output_tokens_total: 150,
    });
    expect(snap2.current_session?.cost_usd_total).toBeCloseTo(0.003, 6);
  });

  it("totals reset to zero in the snapshot when a new session_id is set", async () => {
    setActiveSession({
      provider: "claude",
      session_id: "sess-A",
      ctx_estimate: 0,
    });
    accumulateActiveSessionTokens({
      session_id: "sess-A",
      output_tokens_delta: 999,
      cost_usd_delta: 0.05,
    });

    setActiveSession({
      provider: "claude",
      session_id: "sess-B",
      ctx_estimate: 0,
    });

    const snap = await captureSnapshot(server.port);
    expect(snap.current_session).toMatchObject({
      session_id: "sess-B",
      output_tokens_total: 0,
      cost_usd_total: 0,
    });
  });
});
