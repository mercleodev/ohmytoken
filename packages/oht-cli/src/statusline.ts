import WebSocket from "ws";

import type { WritableLike } from "./cli.js";

// P6-mini status-line reader (gate doc §7). Connects to the OhMyToken event
// bus once, waits for the snapshot frame, prints a single line, and exits.
//
// P1-6 (gate doc §8) extends the connected line with the running token +
// cost totals carried by `SnapshotPayload.current_session`
// (`output_tokens_total`, `cost_usd_total`). Format pinned in §8.1:
//   `oht: connected · <provider> · <session-id-12> · <tokens> · $<cost>`
// where tokens collapse to K/M for ≥ 1000 (no trailing `.0`) and cost is
// fixed 4-decimal. Zero totals still render the segments; missing totals
// (pre-P1-5 snapshot shape) coerce to 0 to keep mid-flight CLI builds
// parseable.

const NOT_RUNNING = "oht: OhMyToken not running";
const SESSION_ID_DISPLAY_LEN = 12;
const TOKEN_K_THRESHOLD = 1000;
const TOKEN_M_THRESHOLD = 1_000_000;
const COST_DECIMALS = 4;

export interface StatuslineDeps {
  out: WritableLike;
  port: number;
  timeoutMs: number;
}

// Mirrors `SnapshotPayload.current_session` from
// `electron/eventBus/events.ts` (the bus-side single source of truth, see
// Phase 1 retrospective review #301, Major #4). Kept structural here because
// `packages/oht-cli` is a separate npm workspace and a cross-package type
// import would require monorepo path mapping or a shared-contracts package
// — both deferred to a follow-up. Update both locations together until that
// follow-up lands.
interface SnapshotFrame {
  op: "snapshot";
  current_session:
    | {
        provider: string;
        session_id: string;
        ctx_estimate: number;
        output_tokens_total?: number;
        cost_usd_total?: number;
      }
    | null;
}

function formatTokens(total: number): string {
  if (total < TOKEN_K_THRESHOLD) {
    return String(total);
  }
  const [unit, divisor] =
    total >= TOKEN_M_THRESHOLD
      ? (["M", TOKEN_M_THRESHOLD] as const)
      : (["K", TOKEN_K_THRESHOLD] as const);
  // toFixed(1) keeps a single decimal; strip trailing `.0` so `12000`
  // renders `12K` (not `12.0K`) per the §8.1 format decision.
  const scaled = (total / divisor).toFixed(1);
  const trimmed = scaled.endsWith(".0") ? scaled.slice(0, -2) : scaled;
  return `${trimmed}${unit}`;
}

function formatCost(cost: number): string {
  return `$${cost.toFixed(COST_DECIMALS)}`;
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
      const truncated = session.session_id.slice(0, SESSION_ID_DISPLAY_LEN);
      const tokensTotal = session.output_tokens_total ?? 0;
      const costTotal = session.cost_usd_total ?? 0;
      finish(
        0,
        `oht: connected · ${session.provider} · ${truncated} · ${formatTokens(
          tokensTotal,
        )} · ${formatCost(costTotal)}`,
      );
    });
  });
}
