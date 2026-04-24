import { describe, it, expect, afterEach } from "vitest";
import WebSocket from "ws";

import {
  bootEventBus,
  shutdownEventBus,
  DEFAULT_EVENT_BUS_PORT,
} from "../boot";
import { resetEventBusClient, emit } from "../client";
import type { HudEvent } from "../events";

const sample: HudEvent = {
  type: "session.provider.active",
  ts: 1_700_000_000_000,
  provider: "claude",
  session_id: "sess-boot",
};

describe("bootEventBus", () => {
  let cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const fn of cleanup.reverse()) {
      await fn();
    }
    cleanup = [];
    resetEventBusClient();
  });

  it("exposes the design-default port (8781) as a named constant for main.ts to import", () => {
    expect(DEFAULT_EVENT_BUS_PORT).toBe(8781);
  });

  it("returns null and never binds when config.enabled is false", async () => {
    const server = await bootEventBus({ port: 0, enabled: false });
    expect(server).toBeNull();
    // emit is still a safe no-op because the client never got bound.
    expect(() => emit(sample)).not.toThrow();
  });

  it("boots a loopback server, binds it to the emit client, and relays events end-to-end", async () => {
    const server = await bootEventBus({
      port: 0,
      enabled: true,
      getSnapshot: () => ({
        current_session: {
          provider: "claude",
          session_id: "sess-boot",
          ctx_estimate: 10,
        },
      }),
    });
    expect(server).not.toBeNull();
    cleanup.push(() => shutdownEventBus(server));

    const port = server!.port;
    expect(server!.address.address).toBe("127.0.0.1");

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

    await waitForFrame(frames, (f) => f.op === "snapshot");

    // emit() goes through the module-global client, proving bootEventBus
    // wired the client to the new server without the caller having to pass
    // the server instance around.
    emit(sample);

    const ev = await waitForFrame(frames, (f) => f.op === "event");
    expect(ev).toMatchObject({
      op: "event",
      payload: { type: "session.provider.active", session_id: "sess-boot" },
    });

    ws.close();
  });

  it("shutdownEventBus unbinds the emit client and stops the server cleanly", async () => {
    const server = await bootEventBus({ port: 0, enabled: true });
    expect(server).not.toBeNull();
    const port = server!.port;

    await shutdownEventBus(server);

    // emit after shutdown must not throw
    expect(() => emit(sample)).not.toThrow();

    // New connections are refused (listener released)
    await expect(connectBriefly(port)).rejects.toThrow();
  });

  it("shutdownEventBus(null) is a safe no-op", async () => {
    await expect(shutdownEventBus(null)).resolves.toBeUndefined();
  });
});

async function waitForFrame(
  frames: Array<Record<string, unknown>>,
  predicate: (f: Record<string, unknown>) => boolean,
  timeoutMs = 1500,
): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const hit = frames.find(predicate);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`no matching frame within ${timeoutMs}ms`);
}

function connectBriefly(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once("open", () => {
      ws.close();
      resolve();
    });
    ws.once("error", (err) => reject(err));
  });
}
