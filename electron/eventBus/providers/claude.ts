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
//
// `historyWatcher` only populates `lastActiveSessionId` lazily (on the next
// fs.watch event or when an IPC handler calls `readRecentHistory`). Without
// the eager read below, dogfooding showed `oht statusline` printed
// `... · unknown · 0 · $0.0000` from boot until the user typed their next
// prompt — even when history.jsonl already had a current session on disk.
// Reading one entry up-front closes that gap; the call is skipped when the
// watcher has already learned a session id (via fs.watch or an earlier
// reader) so we don't reread the file on every restart.
//
// Phase 1 retrospective review (#301) — sessionState now exposes setter and
// announcer as separate functions. This emitter calls them in sequence so
// the heartbeat reaches subscribers exactly when a new session_id lands
// (start, or a non-empty history entry). Empty entries and the gating flag
// short-circuit before either call so neither state nor the wire is touched.

import {
  getLastActiveSessionId,
  readRecentHistory,
} from "../../watcher/historyWatcher";
import type { ProviderEmitter } from "../providerEmitter";
import { announceActiveSession, setActiveSession } from "../sessionState";

let started = false;

export const claudeProviderEmitter: ProviderEmitter = {
  id: "claude",
  start(): void {
    started = true;
    if (!getLastActiveSessionId()) {
      readRecentHistory(1);
    }
    const sessionId = getLastActiveSessionId() || "unknown";
    setActiveSession({
      provider: "claude",
      session_id: sessionId,
      ctx_estimate: 0,
    });
    announceActiveSession({ provider: "claude", session_id: sessionId });
  },
  stop(): void {
    started = false;
  },
};

export function handleClaudeHistoryEntry(entry: { sessionId: string }): void {
  if (!started) {
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
  announceActiveSession({
    provider: "claude",
    session_id: entry.sessionId,
  });
}
