// Phase 0 ships an event bus that always answers `current_session: null`.
// P1-mini (concept-verification track, see docs/sdd/terminal-hud-plugin-gate.md
// §7) gives the bus a single owner of the active session so:
//   - getActiveSnapshot() can be passed to bootEventBus as getSnapshot, so
//     fresh subscribers see the latest known session in their snapshot frame
//   - main.ts can call setActiveSession on boot to seed the value AND emit a
//     session.provider.active heartbeat through the existing emit client
// This module is a deliberately thin seed that Phase 1 will replace with
// real provider switching driven by proxy / watcher signals.

import { emit } from "./client";
import type { Provider } from "./events";
import type { SnapshotPayload } from "./server";

interface ActiveSession {
  provider: Provider;
  session_id: string;
  ctx_estimate: number;
}

let active: ActiveSession | null = null;

export function setActiveSession(
  session: ActiveSession | null,
  ts: number = Date.now(),
): void {
  active = session;
  if (!session) {
    return;
  }
  emit({
    type: "session.provider.active",
    ts,
    provider: session.provider,
    session_id: session.session_id,
  });
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
    },
  };
}

export function resetSessionState(): void {
  active = null;
}
