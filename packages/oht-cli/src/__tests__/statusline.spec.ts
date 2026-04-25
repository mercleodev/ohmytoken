import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocketServer, type WebSocket as WsServerSocket } from "ws";

import { runStatusline } from "../statusline";

class CapturingStream {
  chunks: string[] = [];
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }
  get text(): string {
    return this.chunks.join("");
  }
}

interface FakeBus {
  port: number;
  setSnapshot: (
    payload: {
      current_session:
        | { provider: string; session_id: string; ctx_estimate: number }
        | null;
    } | null,
  ) => void;
  setBeforeSnapshot: (handler: (ws: WsServerSocket) => void) => void;
  stop: () => Promise<void>;
}

async function startFakeBus(): Promise<FakeBus> {
  let snapshot: {
    current_session:
      | { provider: string; session_id: string; ctx_estimate: number }
      | null;
  } | null = { current_session: null };
  let beforeSnapshot: ((ws: WsServerSocket) => void) | null = null;

  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve, reject) => {
    wss.once("listening", () => resolve());
    wss.once("error", reject);
  });

  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      const frame = JSON.parse(raw.toString()) as { op?: string };
      if (frame.op !== "subscribe") return;
      beforeSnapshot?.(ws);
      if (snapshot !== null) {
        ws.send(JSON.stringify({ op: "snapshot", ...snapshot }));
      }
    });
  });

  const addr = wss.address();
  if (typeof addr !== "object" || !addr) {
    throw new Error("failed to bind fake bus");
  }

  return {
    port: addr.port,
    setSnapshot: (payload) => {
      snapshot = payload;
    },
    setBeforeSnapshot: (handler) => {
      beforeSnapshot = handler;
    },
    stop: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) {
          try {
            client.terminate();
          } catch {
            // ignore
          }
        }
        wss.close(() => resolve());
      }),
  };
}

describe("oht statusline runner", () => {
  let bus: FakeBus;

  beforeEach(async () => {
    bus = await startFakeBus();
  });

  afterEach(async () => {
    await bus.stop();
  });

  it("prints connected line with provider + truncated session id when the bus has a session", async () => {
    bus.setSnapshot({
      current_session: {
        provider: "claude",
        session_id: "sess-abcdef0123456789",
        ctx_estimate: 4321,
      },
    });
    const out = new CapturingStream();
    const code = await runStatusline({ out, port: bus.port, timeoutMs: 1000 });
    expect(code).toBe(0);
    // session_id is truncated to the first 12 characters so the line stays
    // readable inside Claude Code's status bar even for UUID-style ids.
    expect(out.text.trim()).toBe(
      "oht: connected · claude · sess-abcdef0",
    );
  });

  it("prints idle line when the bus is up but has no session yet", async () => {
    bus.setSnapshot({ current_session: null });
    const out = new CapturingStream();
    const code = await runStatusline({ out, port: bus.port, timeoutMs: 1000 });
    expect(code).toBe(0);
    expect(out.text.trim()).toBe("oht: connected · idle");
  });

  it("prints 'OhMyToken not running' and exits 2 when the port refuses connection", async () => {
    await bus.stop();
    const port = bus.port; // now closed
    const out = new CapturingStream();
    const code = await runStatusline({ out, port, timeoutMs: 500 });
    expect(code).toBe(2);
    expect(out.text.trim()).toBe("oht: OhMyToken not running");
  });

  it("treats a server that never sends a snapshot frame as 'not running' once the timeout fires", async () => {
    bus.setBeforeSnapshot(() => {
      // Emulate a server that handshakes but never replies to subscribe.
    });
    bus.setSnapshot(null);
    const out = new CapturingStream();
    const code = await runStatusline({ out, port: bus.port, timeoutMs: 200 });
    expect(code).toBe(2);
    expect(out.text.trim()).toBe("oht: OhMyToken not running");
  });

  it("ignores non-snapshot frames and waits for the real snapshot", async () => {
    bus.setBeforeSnapshot((ws) => {
      ws.send(JSON.stringify({ op: "event", payload: { type: "settings.changed", ts: 1, keys: [] } }));
    });
    bus.setSnapshot({
      current_session: {
        provider: "codex",
        session_id: "sess-xyz1234567890",
        ctx_estimate: 0,
      },
    });
    const out = new CapturingStream();
    const code = await runStatusline({ out, port: bus.port, timeoutMs: 1000 });
    expect(code).toBe(0);
    expect(out.text.trim()).toBe(
      "oht: connected · codex · sess-xyz1234",
    );
  });
});
