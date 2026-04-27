// Phase 0 ships an event bus that always answers `current_session: null`.
// P1-mini (concept-verification track, see docs/sdd/terminal-hud-plugin-gate.md
// §7) gives the bus a single owner of the active session so:
//   - getActiveSnapshot() can be passed to bootEventBus as getSnapshot, so
//     fresh subscribers see the latest known session in their snapshot frame
//   - main.ts can call setActiveSession on boot to seed the value AND emit a
//     session.provider.active heartbeat through the existing emit client
//
// P1-5 (gate doc §8) extends the active-session record with running
// `output_tokens_total` + `cost_usd_total`. The proxy emit-site
// (`electron/proxy/server.ts processSseEvents`) calls
// `accumulateActiveSessionTokens` next to the existing emit helpers so the
// snapshot reflects live totals; totals reset on `session_id` change so
// per-session math never bleeds across providers/sessions.
//
// Phase 1 retrospective review (#301) split the seed-and-announce path into
// two single-responsibility functions:
//   - setActiveSession: pure setter (state mutate only, never emits)
//   - announceActiveSession: pure emitter (emit only, never touches state)
// Callers (claude.ts, future codex/gemini emitters) invoke both in sequence.
// The asymmetry "setActiveSession(null) does not emit" is now caller-owned
// by simply not calling announceActiveSession on the null path.

import { emit } from "./client";
import type { Provider, SnapshotPayload } from "./events";

interface ActiveSession {
  provider: Provider;
  session_id: string;
  ctx_estimate: number;
  output_tokens_total: number;
  cost_usd_total: number;
}

type SetActiveSessionInput = {
  provider: Provider;
  session_id: string;
  ctx_estimate: number;
};

let active: ActiveSession | null = null;

export function setActiveSession(session: SetActiveSessionInput | null): void {
  if (!session) {
    active = null;
    return;
  }

  // Capture into a local so the narrowing below does not need a non-null
  // assertion on the module-level `active` (which TS cannot narrow because
  // any other function call could mutate it).
  const prev = active;
  const preserveTotals = prev?.session_id === session.session_id;
  active = {
    provider: session.provider,
    session_id: session.session_id,
    ctx_estimate: session.ctx_estimate,
    output_tokens_total: preserveTotals && prev ? prev.output_tokens_total : 0,
    cost_usd_total: preserveTotals && prev ? prev.cost_usd_total : 0,
  };
}

export function announceActiveSession(args: {
  provider: Provider;
  session_id: string;
  ts?: number;
}): void {
  emit({
    type: "session.provider.active",
    ts: args.ts ?? Date.now(),
    provider: args.provider,
    session_id: args.session_id,
  });
}

export function accumulateActiveSessionTokens(args: {
  session_id: string;
  output_tokens_delta: number;
  cost_usd_delta: number;
}): void {
  if (!active) {
    // No active session yet — orphan delta is dropped. Proxy emits run on
    // a request_id basis and the watcher seeds the session, so this only
    // fires during boot races; ignoring keeps totals deterministic.
    return;
  }
  if (active.session_id !== args.session_id) {
    // Stale delta tagged with a previous session — drop to avoid
    // cross-session bleed. The proxy site is responsible for tagging
    // deltas with the current session id from setActiveSession.
    return;
  }
  active.output_tokens_total += args.output_tokens_delta;
  active.cost_usd_total += args.cost_usd_delta;
}

export function getActiveSnapshot(): SnapshotPayload {
  if (!active) {
    return { current_session: null };
  }
  return {
    current_session: {
      provider: active.provider,
      session_id: active.session_id,
      ctx_estimate: active.ctx_estimate,
      output_tokens_total: active.output_tokens_total,
      cost_usd_total: active.cost_usd_total,
    },
  };
}

export function resetSessionState(): void {
  active = null;
}
