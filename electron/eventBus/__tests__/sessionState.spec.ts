import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";

import {
  bindEventBusServer,
  resetEventBusClient,
} from "../client";
import { createEventBusServer, type EventBusServer } from "../server";
import {
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

    // Snapshot reflects the change immediately.
    expect(getActiveSnapshot()).toEqual({
      current_session: {
        provider: "claude",
        session_id: "sess-mini",
        ctx_estimate: 1234,
      },
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
