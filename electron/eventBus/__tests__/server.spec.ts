import { describe, it, expect, beforeEach, afterEach } from "vitest";
import WebSocket, { type RawData } from "ws";
import {
  createEventBusServer,
  type EventBusServer,
  type SnapshotPayload,
} from "../server";
import type { HudEvent } from "../events";

// --- test helpers ----------------------------------------------------------

type JsonFrame = Record<string, unknown>;

interface BufferedClient {
  ws: WebSocket;
  frames: JsonFrame[];
  ready: Promise<void>;
}

function openBuffered(port: number, token?: string | null): BufferedClient {
  const url = token
    ? `ws://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`
    : `ws://127.0.0.1:${port}`;
  const ws = new WebSocket(url);
  const frames: JsonFrame[] = [];

  // Attach the collector synchronously so no frames can arrive before we are
  // listening — this matters for the auth-rejection path which sends the
  // error frame immediately after the handshake completes.
  ws.on("message", (data) => {
    try {
      frames.push(JSON.parse(data.toString()) as JsonFrame);
    } catch {
      // malformed frame — ignore
    }
  });

  const ready = new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      ws.off("error", onError);
      resolve();
    };
    const onError = (err: Error) => {
      ws.off("open", onOpen);
      reject(err);
    };
    ws.once("open", onOpen);
    ws.once("error", onError);
  });

  return { ws, frames, ready };
}

async function openClient(
  port: number,
  token?: string | null,
): Promise<WebSocket & { __frames: JsonFrame[] }> {
  const client = openBuffered(port, token);
  await client.ready;
  (client.ws as WebSocket & { __frames: JsonFrame[] }).__frames = client.frames;
  return client.ws as WebSocket & { __frames: JsonFrame[] };
}

async function waitForFrame(
  frames: JsonFrame[],
  ws: WebSocket,
  predicate: (msg: JsonFrame) => boolean,
  timeoutMs = 2000,
): Promise<JsonFrame> {
  const existing = frames.find(predicate);
  if (existing) {
    return existing;
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`timeout waiting for matching frame after ${timeoutMs}ms`));
    }, timeoutMs);

    function onMessage(data: RawData) {
      let frame: JsonFrame;
      try {
        frame = JSON.parse(data.toString()) as JsonFrame;
      } catch {
        return;
      }
      if (predicate(frame)) {
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve(frame);
      }
    }

    ws.on("message", onMessage);
  });
}

function waitForMessage(
  ws: WebSocket & { __frames?: JsonFrame[] },
  predicate: (msg: JsonFrame) => boolean,
  timeoutMs = 2000,
): Promise<JsonFrame> {
  const frames = ws.__frames ?? [];
  return waitForFrame(frames, ws, predicate, timeoutMs);
}

function waitForClose(
  ws: WebSocket,
  timeoutMs = 2000,
): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("timeout waiting for close"));
    }, timeoutMs);
    ws.once("close", (code, reasonBuffer) => {
      clearTimeout(timer);
      resolve({ code, reason: reasonBuffer.toString() });
    });
  });
}

function send(ws: WebSocket, frame: JsonFrame): void {
  ws.send(JSON.stringify(frame));
}

function snapshot(): SnapshotPayload {
  return {
    current_session: {
      provider: "claude",
      session_id: "sess-test",
      ctx_estimate: 12_345,
    },
  };
}

const sampleSession: HudEvent = {
  type: "session.provider.active",
  ts: 1_700_000_000_000,
  provider: "claude",
  session_id: "sess-test",
};

const sampleDelta: HudEvent = {
  type: "proxy.sse.message_delta",
  ts: 1_700_000_000_500,
  request_id: "req-1",
  delta_output_tokens: 7,
  cumulative_output_tokens: 42,
  cumulative_cost_usd: 0.0099,
};

// --- tests -----------------------------------------------------------------

describe("event bus WebSocket server", () => {
  let server: EventBusServer;

  beforeEach(async () => {
    server = createEventBusServer({ port: 0, getSnapshot: snapshot });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it("binds only to the loopback interface and on an ephemeral port when 0 is requested", () => {
    expect(server.address.address).toBe("127.0.0.1");
    expect(server.address.port).toBe(server.port);
    expect(server.port).toBeGreaterThan(0);
  });

  it("responds to subscribe with a snapshot frame carrying the current session", async () => {
    const client = await openClient(server.port);
    send(client, { op: "subscribe", types: ["*"] });
    const frame = await waitForMessage(client, (msg) => msg.op === "snapshot");
    expect(frame).toMatchObject({
      op: "snapshot",
      current_session: {
        provider: "claude",
        session_id: "sess-test",
        ctx_estimate: 12_345,
      },
    });
    client.close();
  });

  it("delivers only events matching a subscribed pattern", async () => {
    const client = await openClient(server.port);
    send(client, { op: "subscribe", types: ["session.*"] });
    await waitForMessage(client, (msg) => msg.op === "snapshot");

    const firstEvent = waitForMessage(client, (msg) => msg.op === "event");

    server.emit(sampleDelta); // should NOT match session.* — drop on server side
    server.emit(sampleSession); // should match

    const frame = await firstEvent;
    expect(frame).toMatchObject({
      op: "event",
      payload: { type: "session.provider.active", session_id: "sess-test" },
    });
    client.close();
  });

  it("fans out to multiple subscribers with independent filters", async () => {
    const sessionClient = await openClient(server.port);
    const deltaClient = await openClient(server.port);

    send(sessionClient, { op: "subscribe", types: ["session.*"] });
    send(deltaClient, { op: "subscribe", types: ["proxy.sse.*"] });

    await Promise.all([
      waitForMessage(sessionClient, (msg) => msg.op === "snapshot"),
      waitForMessage(deltaClient, (msg) => msg.op === "snapshot"),
    ]);

    const sessionEventPromise = waitForMessage(
      sessionClient,
      (msg) => msg.op === "event",
    );
    const deltaEventPromise = waitForMessage(
      deltaClient,
      (msg) => msg.op === "event",
    );

    server.emit(sampleSession);
    server.emit(sampleDelta);

    const [sess, delta] = await Promise.all([
      sessionEventPromise,
      deltaEventPromise,
    ]);
    expect((sess.payload as HudEvent).type).toBe("session.provider.active");
    expect((delta.payload as HudEvent).type).toBe("proxy.sse.message_delta");

    sessionClient.close();
    deltaClient.close();
  });

  it("ignores unknown ops gracefully without tearing the connection down", async () => {
    const client = await openClient(server.port);
    send(client, { op: "lol", foo: "bar" });
    send(client, { op: "subscribe", types: ["*"] });
    const snap = await waitForMessage(client, (msg) => msg.op === "snapshot");
    expect(snap.op).toBe("snapshot");
    client.close();
  });

  it("reports accurate connected-client counts across open/close transitions", async () => {
    expect(server.clientCount).toBe(0);
    const c1 = await openClient(server.port);
    const c2 = await openClient(server.port);
    await new Promise((r) => setTimeout(r, 30));
    expect(server.clientCount).toBe(2);
    c1.close();
    await new Promise<void>((resolve) => c1.once("close", () => resolve()));
    await new Promise((r) => setTimeout(r, 30));
    expect(server.clientCount).toBe(1);
    c2.close();
    await new Promise<void>((resolve) => c2.once("close", () => resolve()));
  });
});

describe("event bus WebSocket server -- token auth", () => {
  it("rejects a connection whose token does not match with { op: 'error', code: 'auth' } then closes", async () => {
    const server = createEventBusServer({
      port: 0,
      token: "secret",
      getSnapshot: snapshot,
    });
    await server.start();
    try {
      const client = await openClient(server.port, "wrong");
      const errFrame = await waitForMessage(client, (msg) => msg.op === "error");
      expect(errFrame).toMatchObject({ op: "error", code: "auth" });
      const close = await waitForClose(client);
      expect(close.code).toBeGreaterThanOrEqual(1000);
    } finally {
      await server.stop();
    }
  });

  it("accepts a connection when the token matches", async () => {
    const server = createEventBusServer({
      port: 0,
      token: "secret",
      getSnapshot: snapshot,
    });
    await server.start();
    try {
      const client = await openClient(server.port, "secret");
      send(client, { op: "subscribe", types: ["*"] });
      const snap = await waitForMessage(client, (msg) => msg.op === "snapshot");
      expect(snap.op).toBe("snapshot");
      client.close();
    } finally {
      await server.stop();
    }
  });

  it("rejects a missing token when one is required", async () => {
    const server = createEventBusServer({
      port: 0,
      token: "secret",
      getSnapshot: snapshot,
    });
    await server.start();
    try {
      const client = await openClient(server.port);
      const errFrame = await waitForMessage(client, (msg) => msg.op === "error");
      expect(errFrame).toMatchObject({ op: "error", code: "auth" });
    } finally {
      await server.stop();
    }
  });
});

describe("event bus WebSocket server -- lifecycle", () => {
  it("refuses new connections after stop()", async () => {
    const server = createEventBusServer({ port: 0, getSnapshot: snapshot });
    await server.start();
    const port = server.port;
    await server.stop();

    await expect(openClient(port)).rejects.toThrow();
  });

  it("closes in-flight clients when stop() is called", async () => {
    const server = createEventBusServer({ port: 0, getSnapshot: snapshot });
    await server.start();
    const client = await openClient(server.port);
    const closePromise = waitForClose(client, 3000);
    await server.stop();
    const closed = await closePromise;
    expect(closed.code).toBeGreaterThanOrEqual(1000);
  });
});
