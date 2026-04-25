import WebSocket from "ws";

import type { WritableLike } from "./cli.js";

// P6-mini status-line reader (gate doc §7). Connects to the OhMyToken event
// bus once, waits for the snapshot frame, prints a single line, and exits.
// Phase 6 will replace this with a long-lived reader that streams real
// token / cost data; for the concept-verification track we ship just the
// shape (one line, deterministic exit code) so the user can confirm the
// pipeline lights up Claude Code's status line.

const NOT_RUNNING = "oht: OhMyToken not running";

export interface StatuslineDeps {
  out: WritableLike;
  port: number;
  timeoutMs: number;
}

interface SnapshotFrame {
  op: "snapshot";
  current_session:
    | { provider: string; session_id: string; ctx_estimate: number }
    | null;
}

export async function runStatusline(deps: StatuslineDeps): Promise<number> {
  return new Promise<number>((resolve) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(`ws://127.0.0.1:${deps.port}`);
    } catch {
      deps.out.write(`${NOT_RUNNING}\n`);
      resolve(2);
      return;
    }

    let settled = false;
    const finish = (code: number, line: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // socket may already be closed
      }
      deps.out.write(`${line}\n`);
      resolve(code);
    };

    const timer = setTimeout(() => {
      finish(2, NOT_RUNNING);
    }, deps.timeoutMs);

    ws.on("open", () => {
      ws.send(JSON.stringify({ op: "subscribe", types: ["*"] }));
    });

    ws.on("error", () => {
      finish(2, NOT_RUNNING);
    });

    ws.on("close", () => {
      // If the server closes before we got a snapshot the bus is treated as
      // unavailable. finish() is idempotent so a successful path that
      // already resolved is unaffected.
      finish(2, NOT_RUNNING);
    });

    ws.on("message", (raw) => {
      let frame: { op?: string };
      try {
        frame = JSON.parse(raw.toString()) as { op?: string };
      } catch {
        return;
      }
      if (frame.op !== "snapshot") {
        return;
      }
      const session = (frame as SnapshotFrame).current_session;
      if (!session) {
        finish(0, "oht: connected · idle");
        return;
      }
      const truncated = session.session_id.slice(0, 12);
      finish(0, `oht: connected · ${session.provider} · ${truncated}`);
    });
  });
}
