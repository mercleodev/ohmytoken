import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket from "ws";

import {
  bindEventBusServer,
  emit,
  isEventBusEnabled,
  resetEventBusClient,
  setEventBusEnabled,
} from "../client";
import type { HudEvent } from "../events";
import { createEventBusServer, type EventBusServer } from "../server";

type JsonFrame = Record<string, unknown>;

const deltaEvent: HudEvent = {
  type: "proxy.sse.message_delta",
  ts: 1_700_000_000_000,
  request_id: "req-client-1",
  delta_output_tokens: 3,
  cumulative_output_tokens: 42,
  cumulative_cost_usd: 0.002,
};

function openSubscriber(port: number, types: string[]): {
  ws: WebSocket;
  frames: JsonFrame[];
  ready: Promise<void>;
} {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const frames: JsonFrame[] = [];
  ws.on("message", (data) => {
    try {
      frames.push(JSON.parse(data.toString()) as JsonFrame);
    } catch {
      // ignore malformed
    }
  });
  const ready = new Promise<void>((resolve, reject) => {
    ws.once("open", () => {
      ws.send(JSON.stringify({ op: "subscribe", types }));
      resolve();
    });
    ws.once("error", reject);
  });
  return { ws, frames, ready };
}

async function waitFor<T>(
  predicate: () => T | undefined | false,
  timeoutMs = 1000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = predicate();
    if (value) {
      return value;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

describe("event bus emit client", () => {
  let server: EventBusServer;

  beforeEach(async () => {
    resetEventBusClient();
    server = createEventBusServer({
      port: 0,
      getSnapshot: () => ({ current_session: null }),
    });
    await server.start();
  });

  afterEach(async () => {
    resetEventBusClient();
    await server.stop();
  });

  it("is enabled by default", () => {
    expect(isEventBusEnabled()).toBe(true);
  });

  it("emit() is a silent no-op when no server is bound", () => {
    expect(() => emit(deltaEvent)).not.toThrow();
  });

  it("routes emitted events to matching WebSocket subscribers once the server is bound", async () => {
    bindEventBusServer(server);
    const sub = openSubscriber(server.port, ["proxy.sse.*"]);
    await sub.ready;
    await waitFor(() => sub.frames.find((f) => f.op === "snapshot"));

    emit(deltaEvent);

    const received = await waitFor(() =>
      sub.frames.find((f) => f.op === "event"),
    );
    expect(received).toMatchObject({
      op: "event",
      payload: { type: "proxy.sse.message_delta", request_id: "req-client-1" },
    });
    sub.ws.close();
  });

  it("drops events when the bus is disabled, even if a server is bound", async () => {
    bindEventBusServer(server);
    setEventBusEnabled(false);
    expect(isEventBusEnabled()).toBe(false);

    const sub = openSubscriber(server.port, ["proxy.sse.*"]);
    await sub.ready;
    await waitFor(() => sub.frames.find((f) => f.op === "snapshot"));

    emit(deltaEvent);

    // Wait a grace window and verify no event frame arrives.
    await new Promise((r) => setTimeout(r, 80));
    expect(sub.frames.some((f) => f.op === "event")).toBe(false);
    sub.ws.close();
  });

  it("resumes delivery when the bus is re-enabled", async () => {
    bindEventBusServer(server);
    setEventBusEnabled(false);
    const sub = openSubscriber(server.port, ["proxy.sse.*"]);
    await sub.ready;
    await waitFor(() => sub.frames.find((f) => f.op === "snapshot"));

    emit(deltaEvent); // dropped
    setEventBusEnabled(true);
    emit(deltaEvent); // delivered

    const received = await waitFor(() =>
      sub.frames.find((f) => f.op === "event"),
    );
    expect(received).toMatchObject({
      op: "event",
      payload: { type: "proxy.sse.message_delta" },
    });
    expect(
      sub.frames.filter((f) => f.op === "event").length,
    ).toBe(1);
    sub.ws.close();
  });

  it("unbinding the server with bindEventBusServer(null) stops delivery without throwing", async () => {
    bindEventBusServer(server);
    const sub = openSubscriber(server.port, ["proxy.sse.*"]);
    await sub.ready;
    await waitFor(() => sub.frames.find((f) => f.op === "snapshot"));

    bindEventBusServer(null);
    emit(deltaEvent);

    await new Promise((r) => setTimeout(r, 80));
    expect(sub.frames.some((f) => f.op === "event")).toBe(false);
    sub.ws.close();
  });

  it("resetEventBusClient() restores both the default-enabled flag and clears the bound server", () => {
    bindEventBusServer(server);
    setEventBusEnabled(false);
    resetEventBusClient();
    expect(isEventBusEnabled()).toBe(true);
    expect(() => emit(deltaEvent)).not.toThrow();
  });
});
