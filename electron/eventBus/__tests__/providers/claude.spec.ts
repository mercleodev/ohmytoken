import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../watcher/historyWatcher", () => ({
  getLastActiveSessionId: vi.fn(),
}));

import { getLastActiveSessionId } from "../../../watcher/historyWatcher";
import { resetEventBusClient } from "../../client";
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
});
