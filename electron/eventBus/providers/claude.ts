// P1-2 Claude provider emitter (gate doc §8). Translates `historyWatcher`
// events into `setActiveSession` calls so the event bus snapshot reflects
// whichever Claude session the user is currently running. The watcher itself
// is owned by main.ts (kept that way to avoid taking on the rest of its
// side-effects — IPC, importers, switchSession). main.ts threads each
// onNewEntry payload through `handleClaudeHistoryEntry`, and the gating flag
// here keeps stale entries from sneaking past `stop()`.
//
// `start()` seeds the snapshot with whatever session id the watcher already
// knows (falling back to `"unknown"` when the watcher has not seen any
// activity yet). This preserves the boot-time guarantee that P1-mini's
// heartbeat used to provide — `oht statusline` always has a meaningful line
// to print, never a trailing dot-space (see commit 292b73e and §7.6).

import { getLastActiveSessionId } from "../../watcher/historyWatcher";
import type { ProviderEmitter } from "../providerEmitter";
import { setActiveSession } from "../sessionState";

let active = false;

export const claudeProviderEmitter: ProviderEmitter = {
  id: "claude",
  start(): void {
    active = true;
    const sessionId = getLastActiveSessionId();
    setActiveSession({
      provider: "claude",
      session_id: sessionId || "unknown",
      ctx_estimate: 0,
    });
  },
  stop(): void {
    active = false;
  },
};

export function handleClaudeHistoryEntry(entry: {
  sessionId: string;
}): void {
  if (!active) {
    return;
  }
  if (!entry.sessionId) {
    return;
  }
  setActiveSession({
    provider: "claude",
    session_id: entry.sessionId,
    ctx_estimate: 0,
  });
}
