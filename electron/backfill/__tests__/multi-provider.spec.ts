import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDatabase, getDatabase, closeDatabase } from "../../db/index";
import { clearStatementCache } from "../../db/writer";
import {
  getProviderScanTimestamp,
  setProviderScanTimestamp,
  getLastScanTimestamp,
  setLastScanTimestamp,
} from "../../db/metadata";
import { batchInsertMessages } from "../writer";
import type { BackfillMessage } from "../types";

// --- Test helpers ---

const makeBackfillMessage = (
  overrides: Partial<BackfillMessage> = {},
): BackfillMessage => ({
  dedupKey: `req-mp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  client: "claude",
  modelId: "claude-opus-4-6",
  sessionId: "sess-mp-001",
  projectPath: "test-project",
  timestamp: "2026-02-15T10:00:00.000Z",
  tokens: { input: 100, output: 50, cacheRead: 5000, cacheWrite: 2000 },
  costUsd: 0.05,
  userPrompt: "test prompt",
  ...overrides,
});

// --- Setup / Teardown ---

beforeEach(() => {
  clearStatementCache();
  initDatabase(":memory:");
});

afterEach(() => {
  closeDatabase();
});

// ============================================
// Per-Provider Scan Timestamps
// ============================================

describe("per-provider scan timestamps", () => {
  it("returns null when no provider timestamp is set", () => {
    expect(getProviderScanTimestamp("claude")).toBeNull();
    expect(getProviderScanTimestamp("codex")).toBeNull();
  });

  it("stores and retrieves per-provider timestamps independently", () => {
    setProviderScanTimestamp("claude", 1000);
    setProviderScanTimestamp("codex", 2000);

    expect(getProviderScanTimestamp("claude")).toBe(1000);
    expect(getProviderScanTimestamp("codex")).toBe(2000);
  });

  it("updates provider timestamp without affecting other providers", () => {
    setProviderScanTimestamp("claude", 1000);
    setProviderScanTimestamp("codex", 2000);

    setProviderScanTimestamp("claude", 3000);

    expect(getProviderScanTimestamp("claude")).toBe(3000);
    expect(getProviderScanTimestamp("codex")).toBe(2000);
  });

  it("operates independently from global timestamp", () => {
    setLastScanTimestamp(5000);
    setProviderScanTimestamp("claude", 3000);

    expect(getLastScanTimestamp()).toBe(5000);
    expect(getProviderScanTimestamp("claude")).toBe(3000);
  });
});

// ============================================
// Multi-Provider Batch Insert
// ============================================

describe("multi-provider batch insert", () => {
  it("inserts messages from different providers in one batch", () => {
    const messages = [
      makeBackfillMessage({
        dedupKey: "req-claude-001",
        client: "claude",
        modelId: "claude-opus-4-6",
        timestamp: "2026-02-15T10:00:00.000Z",
      }),
      makeBackfillMessage({
        dedupKey: "req-codex-001",
        client: "codex",
        modelId: "o3",
        timestamp: "2026-02-15T11:00:00.000Z",
      }),
    ];

    const { inserted, errors } = batchInsertMessages(messages);
    expect(inserted).toBe(2);
    expect(errors).toBe(0);
  });

  it("creates separate daily_stats rows per provider", () => {
    const messages = [
      makeBackfillMessage({
        dedupKey: "req-ds-claude",
        client: "claude",
        timestamp: "2026-02-15T10:00:00.000Z",
        costUsd: 0.1,
      }),
      makeBackfillMessage({
        dedupKey: "req-ds-codex",
        client: "codex",
        modelId: "o3",
        timestamp: "2026-02-15T11:00:00.000Z",
        costUsd: 0.2,
      }),
    ];

    batchInsertMessages(messages);

    // Verify DB has distinct daily_stats per provider
    const db = getDatabase();
    const stats = db
      .prepare("SELECT * FROM daily_stats WHERE date = ? ORDER BY provider")
      .all("2026-02-15") as Array<Record<string, unknown>>;

    expect(stats).toHaveLength(2);
    expect(stats[0].provider).toBe("claude");
    expect(stats[0].total_cost_usd).toBeCloseTo(0.1);
    expect(stats[1].provider).toBe("codex");
    expect(stats[1].total_cost_usd).toBeCloseTo(0.2);
  });

  it("creates separate sessions per provider", () => {
    const messages = [
      makeBackfillMessage({
        dedupKey: "req-sess-claude",
        client: "claude",
        sessionId: "sess-shared-id",
        timestamp: "2026-02-15T10:00:00.000Z",
      }),
      makeBackfillMessage({
        dedupKey: "req-sess-codex",
        client: "codex",
        modelId: "o3",
        sessionId: "sess-codex-id",
        timestamp: "2026-02-15T11:00:00.000Z",
      }),
    ];

    batchInsertMessages(messages);

    const db = getDatabase();
    const sessions = db
      .prepare("SELECT session_id, provider FROM sessions ORDER BY session_id")
      .all() as Array<Record<string, unknown>>;

    expect(sessions).toHaveLength(2);
    const providers = sessions.map((s) => s.provider);
    expect(providers).toContain("claude");
    expect(providers).toContain("codex");
  });
});
