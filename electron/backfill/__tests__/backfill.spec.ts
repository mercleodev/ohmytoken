import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDatabase, getDatabase, closeDatabase } from "../../db/index";
import { clearStatementCache, insertPrompt } from "../../db/writer";
import type { InsertPromptData } from "../../db/writer";
import { loadExistingRequestIds, filterDuplicates } from "../dedup";
import { batchInsertMessages } from "../writer";
import type { BackfillMessage } from "../types";

// --- Test helpers ---

const makeBackfillMessage = (
  overrides: Partial<BackfillMessage> = {},
): BackfillMessage => ({
  dedupKey: `req-bf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  client: "claude",
  modelId: "claude-opus-4-6",
  sessionId: "sess-bf-001",
  projectPath: "test-project",
  timestamp: "2026-02-15T10:00:00.000Z",
  tokens: { input: 100, output: 50, cacheRead: 5000, cacheWrite: 2000 },
  costUsd: 0.05,
  userPrompt: "test prompt",
  ...overrides,
});

const makePromptData = (
  requestId: string,
): InsertPromptData => ({
  prompt: {
    request_id: requestId,
    session_id: "sess-existing",
    timestamp: "2026-02-14T10:00:00.000Z",
    source: "proxy",
    user_prompt: "existing prompt",
    user_prompt_tokens: 10,
    model: "claude-opus-4-6",
    max_tokens: 8192,
    input_tokens: 50,
    output_tokens: 100,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    cost_usd: 0.03,
    total_context_tokens: 5000,
  },
  injected_files: [],
  tool_calls: [],
  agent_calls: [],
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
// Dedup
// ============================================

describe("dedup", () => {
  describe("loadExistingRequestIds", () => {
    it("returns empty set for empty DB", () => {
      const ids = loadExistingRequestIds();
      expect(ids.size).toBe(0);
    });

    it("returns set with existing request_ids", () => {
      insertPrompt(makePromptData("req-existing-001"));
      insertPrompt(makePromptData("req-existing-002"));

      const ids = loadExistingRequestIds();
      expect(ids.size).toBe(2);
      expect(ids.has("req-existing-001")).toBe(true);
      expect(ids.has("req-existing-002")).toBe(true);
    });
  });

  describe("filterDuplicates", () => {
    it("returns all messages when no existing ids", () => {
      const messages = [
        makeBackfillMessage({ dedupKey: "req-new-001" }),
        makeBackfillMessage({ dedupKey: "req-new-002" }),
      ];
      const existingIds = new Set<string>();

      const { unique, duplicateCount } = filterDuplicates(messages, existingIds);
      expect(unique).toHaveLength(2);
      expect(duplicateCount).toBe(0);
    });

    it("filters out existing request_ids", () => {
      const messages = [
        makeBackfillMessage({ dedupKey: "req-old-001" }),
        makeBackfillMessage({ dedupKey: "req-new-001" }),
        makeBackfillMessage({ dedupKey: "req-old-002" }),
      ];
      const existingIds = new Set(["req-old-001", "req-old-002"]);

      const { unique, duplicateCount } = filterDuplicates(messages, existingIds);
      expect(unique).toHaveLength(1);
      expect(unique[0].dedupKey).toBe("req-new-001");
      expect(duplicateCount).toBe(2);
    });

    it("prevents intra-batch duplicates", () => {
      const messages = [
        makeBackfillMessage({ dedupKey: "req-dup-001" }),
        makeBackfillMessage({ dedupKey: "req-dup-001" }),
      ];
      const existingIds = new Set<string>();

      const { unique, duplicateCount } = filterDuplicates(messages, existingIds);
      expect(unique).toHaveLength(1);
      expect(duplicateCount).toBe(1);
    });

    it("adds seen keys to existingIds set", () => {
      const messages = [makeBackfillMessage({ dedupKey: "req-track-001" })];
      const existingIds = new Set<string>();

      filterDuplicates(messages, existingIds);
      expect(existingIds.has("req-track-001")).toBe(true);
    });
  });
});

// ============================================
// Batch Writer
// ============================================

describe("batchInsertMessages", () => {
  it("inserts messages into prompts table", () => {
    const messages = [
      makeBackfillMessage({
        dedupKey: "req-batch-001",
        timestamp: "2026-02-15T10:00:00.000Z",
      }),
      makeBackfillMessage({
        dedupKey: "req-batch-002",
        timestamp: "2026-02-15T11:00:00.000Z",
      }),
    ];

    const { inserted, errors } = batchInsertMessages(messages);
    expect(inserted).toBe(2);
    expect(errors).toBe(0);

    const db = getDatabase();
    const rows = db
      .prepare("SELECT * FROM prompts ORDER BY timestamp")
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0].request_id).toBe("req-batch-001");
    expect(rows[0].source).toBe("file-scan");
    expect(rows[1].request_id).toBe("req-batch-002");
  });

  it("sets correct source as file-scan", () => {
    const msg = makeBackfillMessage({ dedupKey: "req-source-check" });
    batchInsertMessages([msg]);

    const db = getDatabase();
    const row = db
      .prepare("SELECT source FROM prompts WHERE request_id = ?")
      .get("req-source-check") as Record<string, unknown>;
    expect(row.source).toBe("file-scan");
  });

  it("stores token values correctly", () => {
    const msg = makeBackfillMessage({
      dedupKey: "req-tokens-check",
      tokens: { input: 200, output: 100, cacheRead: 3000, cacheWrite: 1500 },
    });
    batchInsertMessages([msg]);

    const db = getDatabase();
    const row = db
      .prepare("SELECT * FROM prompts WHERE request_id = ?")
      .get("req-tokens-check") as Record<string, unknown>;
    expect(row.input_tokens).toBe(200);
    expect(row.output_tokens).toBe(100);
    expect(row.cache_read_input_tokens).toBe(3000);
    expect(row.cache_creation_input_tokens).toBe(1500);
  });

  it("rebuilds daily_stats after batch insert", () => {
    const messages = [
      makeBackfillMessage({
        dedupKey: "req-ds-001",
        timestamp: "2026-02-15T10:00:00.000Z",
        costUsd: 0.1,
      }),
      makeBackfillMessage({
        dedupKey: "req-ds-002",
        timestamp: "2026-02-15T14:00:00.000Z",
        costUsd: 0.2,
      }),
    ];
    batchInsertMessages(messages);

    const db = getDatabase();
    const stat = db
      .prepare("SELECT * FROM daily_stats WHERE date = ?")
      .get("2026-02-15") as Record<string, unknown>;
    expect(stat).toBeDefined();
    expect(stat.request_count).toBe(2);
    expect(stat.total_cost_usd).toBeCloseTo(0.3);
  });

  it("rebuilds sessions after batch insert", () => {
    const messages = [
      makeBackfillMessage({
        dedupKey: "req-sess-001",
        sessionId: "sess-batch-test",
        timestamp: "2026-02-15T10:00:00.000Z",
        costUsd: 0.1,
      }),
      makeBackfillMessage({
        dedupKey: "req-sess-002",
        sessionId: "sess-batch-test",
        timestamp: "2026-02-15T12:00:00.000Z",
        costUsd: 0.15,
      }),
    ];
    batchInsertMessages(messages);

    const db = getDatabase();
    const sess = db
      .prepare("SELECT * FROM sessions WHERE session_id = ?")
      .get("sess-batch-test") as Record<string, unknown>;
    expect(sess).toBeDefined();
    expect(sess.prompt_count).toBe(2);
    expect(sess.total_cost_usd).toBeCloseTo(0.25);
    expect(sess.first_timestamp).toBe("2026-02-15T10:00:00.000Z");
    expect(sess.last_timestamp).toBe("2026-02-15T12:00:00.000Z");
  });

  it("skips duplicate request_ids gracefully", () => {
    const msg = makeBackfillMessage({ dedupKey: "req-dup-batch" });
    batchInsertMessages([msg]);

    // Insert again with same dedupKey
    const { inserted } = batchInsertMessages([msg]);
    expect(inserted).toBe(0);
  });

  it("handles empty array", () => {
    const { inserted, errors } = batchInsertMessages([]);
    expect(inserted).toBe(0);
    expect(errors).toBe(0);
  });

  it("stores tool_summary as JSON", () => {
    const msg = makeBackfillMessage({
      dedupKey: "req-tools-check",
      toolSummary: { Read: 3, Edit: 1 },
    });
    batchInsertMessages([msg]);

    const db = getDatabase();
    const row = db
      .prepare("SELECT tool_summary FROM prompts WHERE request_id = ?")
      .get("req-tools-check") as Record<string, unknown>;
    expect(row.tool_summary).toBeDefined();
    const parsed = JSON.parse(row.tool_summary as string);
    expect(parsed).toEqual({ Read: 3, Edit: 1 });
  });
});

// ============================================
// Integration: dedup + writer pipeline
// ============================================

describe("dedup → writer pipeline", () => {
  it("skips messages already in DB via proxy", () => {
    // Simulate existing proxy data
    insertPrompt(makePromptData("req-proxy-001"));
    insertPrompt(makePromptData("req-proxy-002"));

    // Backfill messages: 2 duplicates + 1 new
    const messages = [
      makeBackfillMessage({ dedupKey: "req-proxy-001" }),
      makeBackfillMessage({ dedupKey: "req-proxy-002" }),
      makeBackfillMessage({ dedupKey: "req-new-001" }),
    ];

    const existingIds = loadExistingRequestIds();
    const { unique, duplicateCount } = filterDuplicates(messages, existingIds);

    expect(unique).toHaveLength(1);
    expect(duplicateCount).toBe(2);

    const { inserted } = batchInsertMessages(unique);
    expect(inserted).toBe(1);

    const db = getDatabase();
    const total = (
      db.prepare("SELECT COUNT(*) as c FROM prompts").get() as Record<string, number>
    ).c;
    expect(total).toBe(3); // 2 proxy + 1 backfill
  });

  it("preserves proxy source when backfill has same request_id", () => {
    insertPrompt(makePromptData("req-priority-001"));

    const messages = [makeBackfillMessage({ dedupKey: "req-priority-001" })];
    const existingIds = loadExistingRequestIds();
    const { unique } = filterDuplicates(messages, existingIds);

    expect(unique).toHaveLength(0);

    // Original proxy row untouched
    const db = getDatabase();
    const row = db
      .prepare("SELECT source FROM prompts WHERE request_id = ?")
      .get("req-priority-001") as Record<string, unknown>;
    expect(row.source).toBe("proxy");
  });

  it("handles large batch without errors", () => {
    const messages = Array.from({ length: 100 }, (_, i) =>
      makeBackfillMessage({
        dedupKey: `req-large-${i}`,
        timestamp: `2026-02-15T${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000Z`,
        costUsd: 0.01,
      }),
    );

    const existingIds = loadExistingRequestIds();
    const { unique } = filterDuplicates(messages, existingIds);
    const { inserted, errors } = batchInsertMessages(unique);

    expect(inserted).toBe(100);
    expect(errors).toBe(0);

    const db = getDatabase();
    const total = (
      db.prepare("SELECT COUNT(*) as c FROM prompts").get() as Record<string, number>
    ).c;
    expect(total).toBe(100);
  });
});
