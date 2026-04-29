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

interface SnapshotSession {
  provider: string;
  session_id: string;
  ctx_estimate: number;
  output_tokens_total?: number;
  cost_usd_total?: number;
}

interface FakeBus {
  port: number;
  setSnapshot: (
    payload: {
      current_session: SnapshotSession | null;
    } | null,
  ) => void;
  setBeforeSnapshot: (handler: (ws: WsServerSocket) => void) => void;
  stop: () => Promise<void>;
}

async function startFakeBus(): Promise<FakeBus> {
  let snapshot: {
    current_session: SnapshotSession | null;
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

  it("prints connected line with provider, truncated session id, token total, and cost when the bus has a session with totals", async () => {
    bus.setSnapshot({
      current_session: {
        provider: "claude",
        session_id: "sess-abcdef0123456789",
        ctx_estimate: 4321,
        output_tokens_total: 1234,
        cost_usd_total: 0.0042,
      },
    });
    const out = new CapturingStream();
    const code = await runStatusline({ out, port: bus.port, timeoutMs: 1000 });
    expect(code).toBe(0);
    // session_id is truncated to the first 12 characters so the line stays
    // readable inside Claude Code's status bar even for UUID-style ids.
    // Tokens collapse to K (1.2K), cost is fixed 4-decimal ($0.0042).
    expect(out.text.trim()).toBe(
      "oht: connected · claude · sess-abcdef0 · 1.2K · $0.0042",
    );
  });

  it("renders zero-state totals as `· 0 · $0.0000` when a session has just been seeded", async () => {
    // Phase 1 exit: statusline always includes session id + token total
    // + cost. A fresh session with totals=0 must still render the
    // segments — never collapse them, so the format stays predictable
    // for downstream parsers and the user sees the structure light up.
    bus.setSnapshot({
      current_session: {
        provider: "claude",
        session_id: "sess-fresh01abcdef",
        ctx_estimate: 0,
        output_tokens_total: 0,
        cost_usd_total: 0,
      },
    });
    const out = new CapturingStream();
    const code = await runStatusline({ out, port: bus.port, timeoutMs: 1000 });
    expect(code).toBe(0);
    expect(out.text.trim()).toBe(
      "oht: connected · claude · sess-fresh01 · 0 · $0.0000",
    );
  });

  it("coerces missing totals to 0 (pre-P1-5 snapshot shape)", async () => {
    // SnapshotPayload added totals as optional/zero-default in P1-5 to
    // keep mid-flight CLI builds parseable. If a snapshot frame omits
    // them, the CLI must fall back to zero rather than printing
    // `undefined` or crashing.
    bus.setSnapshot({
      current_session: {
        provider: "claude",
        session_id: "sess-legacy-9999",
        ctx_estimate: 99,
      },
    });
    const out = new CapturingStream();
    const code = await runStatusline({ out, port: bus.port, timeoutMs: 1000 });
    expect(code).toBe(0);
    expect(out.text.trim()).toBe(
      "oht: connected · claude · sess-legacy- · 0 · $0.0000",
    );
  });

  it("collapses tokens to K with one decimal, no trailing .0, and to M for millions", async () => {
    bus.setSnapshot({
      current_session: {
        provider: "claude",
        session_id: "sess-bigvolume0001",
        ctx_estimate: 0,
        output_tokens_total: 12_000, // → 12K (no `.0`)
        cost_usd_total: 1.2345,
      },
    });
    const out = new CapturingStream();
    const code = await runStatusline({ out, port: bus.port, timeoutMs: 1000 });
    expect(code).toBe(0);
    expect(out.text.trim()).toBe(
      "oht: connected · claude · sess-bigvolu · 12K · $1.2345",
    );

    bus.setSnapshot({
      current_session: {
        provider: "claude",
        session_id: "sess-megavolume001",
        ctx_estimate: 0,
        output_tokens_total: 1_500_000, // → 1.5M
        cost_usd_total: 12.3456,
      },
    });
    const out2 = new CapturingStream();
    const code2 = await runStatusline({
      out: out2,
      port: bus.port,
      timeoutMs: 1000,
    });
    expect(code2).toBe(0);
    expect(out2.text.trim()).toBe(
      "oht: connected · claude · sess-megavol · 1.5M · $12.3456",
    );
  });

  it("keeps small token counts as raw integers (under 1000)", async () => {
    bus.setSnapshot({
      current_session: {
        provider: "claude",
        session_id: "sess-tinyvolume001",
        ctx_estimate: 0,
        output_tokens_total: 42,
        cost_usd_total: 0.00012,
      },
    });
    const out = new CapturingStream();
    const code = await runStatusline({ out, port: bus.port, timeoutMs: 1000 });
    expect(code).toBe(0);
    expect(out.text.trim()).toBe(
      "oht: connected · claude · sess-tinyvol · 42 · $0.0001",
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
        output_tokens_total: 250,
        cost_usd_total: 0.001,
      },
    });
    const out = new CapturingStream();
    const code = await runStatusline({ out, port: bus.port, timeoutMs: 1000 });
    expect(code).toBe(0);
    expect(out.text.trim()).toBe(
      "oht: connected · codex · sess-xyz1234 · 250 · $0.0010",
    );
  });
});
