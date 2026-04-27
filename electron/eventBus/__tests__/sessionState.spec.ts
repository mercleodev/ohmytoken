import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";

import {
  bindEventBusServer,
  resetEventBusClient,
} from "../client";
import { createEventBusServer, type EventBusServer } from "../server";
import {
  accumulateActiveSessionTokens,
  getActiveSnapshot,
  resetSessionState,
  setActiveSession,
} from "../sessionState";

describe("sessionState heartbeat helper", () => {
  let server: EventBusServer;

  beforeEach(async () => {
    resetSessionState();
    resetEventBusClient();
    server = createEventBusServer({
      port: 0,
      getSnapshot: getActiveSnapshot,
    });
    await server.start();
    bindEventBusServer(server);
  });

  afterEach(async () => {
    bindEventBusServer(null);
    await server.stop();
    resetSessionState();
  });

  it("returns { current_session: null } before any session is set", () => {
    expect(getActiveSnapshot()).toEqual({ current_session: null });
  });

  it("setActiveSession populates the snapshot and emits a session.provider.active event", async () => {
    // Subscribe BEFORE setActiveSession so the heartbeat reaches us.
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const frames: Array<Record<string, unknown>> = [];
    ws.on("message", (raw) => {
      frames.push(JSON.parse(raw.toString()) as Record<string, unknown>);
    });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    ws.send(JSON.stringify({ op: "subscribe", types: ["session.*"] }));
    // The snapshot reply also doubles as the "subscribe is processed" ack —
    // emitting before that point races the server's subscriber registration.
    await waitFor(() => frames.find((f) => f.op === "snapshot"));

    setActiveSession({
      provider: "claude",
      session_id: "sess-mini",
      ctx_estimate: 1234,
    });

    // Snapshot reflects the change immediately. P1-5 added totals; the
    // P1-mini contract here is just "metadata is in the snapshot", so we
    // assert the metadata triple and let the running-totals suite below
    // own the totals invariants.
    expect(getActiveSnapshot().current_session).toMatchObject({
      provider: "claude",
      session_id: "sess-mini",
      ctx_estimate: 1234,
    });

    // The subscriber receives a session.provider.active event.
    const heartbeat = await waitFor(() =>
      frames.find(
        (f) =>
          f.op === "event" &&
          (f.payload as { type: string }).type === "session.provider.active",
      ),
    );
    expect(heartbeat).toMatchObject({
      op: "event",
      payload: {
        type: "session.provider.active",
        provider: "claude",
        session_id: "sess-mini",
      },
    });

    ws.close();
  });

  it("setActiveSession(null) clears the snapshot and does not emit", async () => {
    setActiveSession({
      provider: "claude",
      session_id: "sess-1",
      ctx_estimate: 0,
    });
    // Subscribe AFTER the first emit; expect no further events on null reset.
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
    const frames: Array<Record<string, unknown>> = [];
    ws.on("message", (raw) => {
      frames.push(JSON.parse(raw.toString()) as Record<string, unknown>);
    });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    ws.send(JSON.stringify({ op: "subscribe", types: ["session.*"] }));
    await waitFor(() => frames.find((f) => f.op === "snapshot"));

    setActiveSession(null);
    expect(getActiveSnapshot()).toEqual({ current_session: null });

    await new Promise((r) => setTimeout(r, 80));
    expect(frames.some((f) => f.op === "event")).toBe(false);
    ws.close();
  });

  it("a fresh subscriber receives the latest setActiveSession value in its snapshot frame", async () => {
    setActiveSession({
      provider: "codex",
      session_id: "sess-late",
      ctx_estimate: 9999,
    });

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
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
    expect(snap).toMatchObject({
      op: "snapshot",
      current_session: {
        provider: "codex",
        session_id: "sess-late",
        ctx_estimate: 9999,
      },
    });
    ws.close();
  });

  it("resetSessionState clears the snapshot back to null", () => {
    setActiveSession({
      provider: "gemini",
      session_id: "sess-x",
      ctx_estimate: 0,
    });
    expect(getActiveSnapshot().current_session).not.toBeNull();
    resetSessionState();
    expect(getActiveSnapshot()).toEqual({ current_session: null });
  });
});

describe("sessionState running token + cost totals (P1-5)", () => {
  beforeEach(() => {
    resetSessionState();
  });

  afterEach(() => {
    resetSessionState();
  });

  it("setActiveSession seeds totals to zero in the snapshot", () => {
    setActiveSession({
      provider: "claude",
      session_id: "sess-totals",
      ctx_estimate: 0,
    });
    expect(getActiveSnapshot().current_session).toMatchObject({
      provider: "claude",
      session_id: "sess-totals",
      output_tokens_total: 0,
      cost_usd_total: 0,
    });
  });

  it("accumulateActiveSessionTokens cumulates output tokens across N events", () => {
    setActiveSession({
      provider: "claude",
      session_id: "sess-totals",
      ctx_estimate: 0,
    });

    accumulateActiveSessionTokens({
      session_id: "sess-totals",
      output_tokens_delta: 30,
      cost_usd_delta: 0.001,
    });
    accumulateActiveSessionTokens({
      session_id: "sess-totals",
      output_tokens_delta: 20,
      cost_usd_delta: 0.0007,
    });
    accumulateActiveSessionTokens({
      session_id: "sess-totals",
      output_tokens_delta: 50,
      cost_usd_delta: 0.0015,
    });

    const snap = getActiveSnapshot().current_session;
    expect(snap?.output_tokens_total).toBe(100);
    // 0.001 + 0.0007 + 0.0015 = 0.0032 — guard against fp drift
    expect(snap?.cost_usd_total).toBeCloseTo(0.0032, 6);
  });

  it("setActiveSession with a different session_id resets totals to zero", () => {
    setActiveSession({
      provider: "claude",
      session_id: "sess-A",
      ctx_estimate: 0,
    });
    accumulateActiveSessionTokens({
      session_id: "sess-A",
      output_tokens_delta: 100,
      cost_usd_delta: 0.005,
    });
    expect(getActiveSnapshot().current_session?.output_tokens_total).toBe(100);

    setActiveSession({
      provider: "claude",
      session_id: "sess-B",
      ctx_estimate: 0,
    });
    expect(getActiveSnapshot().current_session).toMatchObject({
      session_id: "sess-B",
      output_tokens_total: 0,
      cost_usd_total: 0,
    });
  });

  it("setActiveSession with the same session_id preserves running totals", () => {
    setActiveSession({
      provider: "claude",
      session_id: "sess-keep",
      ctx_estimate: 0,
    });
    accumulateActiveSessionTokens({
      session_id: "sess-keep",
      output_tokens_delta: 42,
      cost_usd_delta: 0.0021,
    });

    // Re-seeding (e.g., ctx_estimate update) must not clobber totals.
    setActiveSession({
      provider: "claude",
      session_id: "sess-keep",
      ctx_estimate: 9876,
    });

    expect(getActiveSnapshot().current_session).toMatchObject({
      session_id: "sess-keep",
      ctx_estimate: 9876,
      output_tokens_total: 42,
      cost_usd_total: 0.0021,
    });
  });

  it("accumulateActiveSessionTokens is a no-op when no active session", () => {
    accumulateActiveSessionTokens({
      session_id: "sess-orphan",
      output_tokens_delta: 9999,
      cost_usd_delta: 1.0,
    });
    expect(getActiveSnapshot()).toEqual({ current_session: null });
  });

  it("accumulateActiveSessionTokens ignores deltas tagged with a different session_id", () => {
    setActiveSession({
      provider: "claude",
      session_id: "sess-current",
      ctx_estimate: 0,
    });
    accumulateActiveSessionTokens({
      session_id: "sess-stale",
      output_tokens_delta: 500,
      cost_usd_delta: 1.0,
    });
    expect(getActiveSnapshot().current_session).toMatchObject({
      session_id: "sess-current",
      output_tokens_total: 0,
      cost_usd_total: 0,
    });
  });

  it("resetSessionState wipes accumulated totals", () => {
    setActiveSession({
      provider: "claude",
      session_id: "sess-clear",
      ctx_estimate: 0,
    });
    accumulateActiveSessionTokens({
      session_id: "sess-clear",
      output_tokens_delta: 17,
      cost_usd_delta: 0.0008,
    });
    resetSessionState();
    expect(getActiveSnapshot()).toEqual({ current_session: null });

    // Re-seed and confirm we start at zero again.
    setActiveSession({
      provider: "claude",
      session_id: "sess-clear",
      ctx_estimate: 0,
    });
    expect(getActiveSnapshot().current_session).toMatchObject({
      output_tokens_total: 0,
      cost_usd_total: 0,
    });
  });
});

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
