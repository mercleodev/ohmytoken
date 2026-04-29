import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../watcher/historyWatcher", () => ({
  getLastActiveSessionId: vi.fn(),
  readRecentHistory: vi.fn(),
}));

vi.mock("../../client", () => ({
  emit: vi.fn(),
  resetEventBusClient: vi.fn(),
}));

import {
  getLastActiveSessionId,
  readRecentHistory,
} from "../../../watcher/historyWatcher";
import { emit, resetEventBusClient } from "../../client";
import {
  claudeProviderEmitter,
  handleClaudeHistoryEntry,
} from "../../providers/claude";
import { getActiveSnapshot, resetSessionState } from "../../sessionState";

describe("ClaudeProviderEmitter", () => {
  beforeEach(() => {
    claudeProviderEmitter.stop();
    resetSessionState();
    resetEventBusClient();
    vi.mocked(getLastActiveSessionId).mockReturnValue("");
    vi.mocked(readRecentHistory).mockReset();
    vi.mocked(readRecentHistory).mockReturnValue([]);
    vi.mocked(emit).mockClear();
  });

  it("identifies as claude", () => {
    expect(claudeProviderEmitter.id).toBe("claude");
  });

  it("start() seeds active session with the last known id when present", () => {
    vi.mocked(getLastActiveSessionId).mockReturnValue(
      "sess-abc-1234567890",
    );

    claudeProviderEmitter.start();

    // P1-5 added running totals (output_tokens_total, cost_usd_total)
    // to the snapshot. The Claude emitter contract owns metadata
    // (provider/session_id/ctx_estimate) and must seed totals to zero
    // — covered by the dedicated suite in sessionState.spec.ts.
    expect(getActiveSnapshot().current_session).toMatchObject({
      provider: "claude",
      session_id: "sess-abc-1234567890",
      ctx_estimate: 0,
      output_tokens_total: 0,
      cost_usd_total: 0,
    });
  });

  it("start() falls back to 'unknown' when the watcher has no session yet", () => {
    vi.mocked(getLastActiveSessionId).mockReturnValue("");

    claudeProviderEmitter.start();

    expect(getActiveSnapshot().current_session).toMatchObject({
      provider: "claude",
      session_id: "unknown",
      ctx_estimate: 0,
      output_tokens_total: 0,
      cost_usd_total: 0,
    });
  });

  // Boot-race fix (#301 follow-up dogfooding): when the bus starts before
  // the user types a new prompt, history.jsonl has not been read yet and
  // statusline shows "unknown" until the next entry lands. Eagerly seeding
  // via readRecentHistory(1) closes that gap.
  it("start() seeds session_id via readRecentHistory when watcher has none yet", () => {
    let cachedId = "";
    vi.mocked(getLastActiveSessionId).mockImplementation(() => cachedId);
    vi.mocked(readRecentHistory).mockImplementation(() => {
      cachedId = "sess-from-history-1234";
      return [];
    });

    claudeProviderEmitter.start();

    expect(readRecentHistory).toHaveBeenCalledWith(1);
    expect(getActiveSnapshot().current_session?.session_id).toBe(
      "sess-from-history-1234",
    );
  });

  it("start() skips readRecentHistory when the watcher already knows the session", () => {
    vi.mocked(getLastActiveSessionId).mockReturnValue("sess-already-known");

    claudeProviderEmitter.start();

    expect(readRecentHistory).not.toHaveBeenCalled();
  });

  it("handleClaudeHistoryEntry updates the active session when started", () => {
    claudeProviderEmitter.start();

    handleClaudeHistoryEntry({ sessionId: "sess-new-9999999999" });

    expect(getActiveSnapshot().current_session).toMatchObject({
      provider: "claude",
      session_id: "sess-new-9999999999",
      ctx_estimate: 0,
      output_tokens_total: 0,
      cost_usd_total: 0,
    });
  });

  it("handleClaudeHistoryEntry is a no-op before start()", () => {
    handleClaudeHistoryEntry({ sessionId: "sess-ignored" });

    expect(getActiveSnapshot()).toEqual({ current_session: null });
  });

  it("stop() prevents subsequent history entries from updating the snapshot", () => {
    claudeProviderEmitter.start();
    handleClaudeHistoryEntry({ sessionId: "first" });
    expect(getActiveSnapshot().current_session?.session_id).toBe("first");

    claudeProviderEmitter.stop();
    handleClaudeHistoryEntry({ sessionId: "after-stop" });

    expect(getActiveSnapshot().current_session?.session_id).toBe("first");
  });

  it("ignores empty session ids — keeps the seeded fallback intact", () => {
    claudeProviderEmitter.start();

    handleClaudeHistoryEntry({ sessionId: "" });

    expect(getActiveSnapshot().current_session?.session_id).toBe("unknown");
  });

  it("a second start() re-seeds with the latest watcher value", () => {
    vi.mocked(getLastActiveSessionId).mockReturnValue("first-id");
    claudeProviderEmitter.start();
    expect(getActiveSnapshot().current_session?.session_id).toBe("first-id");

    claudeProviderEmitter.stop();
    vi.mocked(getLastActiveSessionId).mockReturnValue("second-id");
    claudeProviderEmitter.start();

    expect(getActiveSnapshot().current_session?.session_id).toBe(
      "second-id",
    );
  });

  // Phase 1 retrospective review (#301) — sessionState now exposes setter
  // and announcer separately. The emitter must call both so subscribers
  // see a heartbeat exactly when the session_id changes.

  it("start() announces the seeded session_id on the wire", () => {
    vi.mocked(getLastActiveSessionId).mockReturnValue("sess-abc-1234567890");

    claudeProviderEmitter.start();

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.provider.active",
        provider: "claude",
        session_id: "sess-abc-1234567890",
      }),
    );
  });

  it("start() with no watcher session announces 'unknown' so subscribers always see one heartbeat", () => {
    vi.mocked(getLastActiveSessionId).mockReturnValue("");

    claudeProviderEmitter.start();

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.provider.active",
        provider: "claude",
        session_id: "unknown",
      }),
    );
  });

  it("handleClaudeHistoryEntry announces the new session when started", () => {
    claudeProviderEmitter.start();
    vi.mocked(emit).mockClear();

    handleClaudeHistoryEntry({ sessionId: "sess-new-9999999999" });

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "session.provider.active",
        provider: "claude",
        session_id: "sess-new-9999999999",
      }),
    );
  });

  it("handleClaudeHistoryEntry does not announce after stop()", () => {
    claudeProviderEmitter.start();
    claudeProviderEmitter.stop();
    vi.mocked(emit).mockClear();

    handleClaudeHistoryEntry({ sessionId: "after-stop" });

    expect(emit).not.toHaveBeenCalled();
  });

  it("handleClaudeHistoryEntry does not announce on empty session id", () => {
    claudeProviderEmitter.start();
    vi.mocked(emit).mockClear();

    handleClaudeHistoryEntry({ sessionId: "" });

    expect(emit).not.toHaveBeenCalled();
  });
});
