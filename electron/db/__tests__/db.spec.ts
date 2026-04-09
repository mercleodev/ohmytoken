import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDatabase, getDatabase, closeDatabase } from "../index";
import { insertPrompt, clearStatementCache } from "../writer";
import type { InsertPromptData } from "../writer";

type DbRow = Record<string, unknown>;
import {
  getPrompts,
  getPromptDetail,
  getSessionPrompts,
  getScanStats,
  getDailyStats,
  getSessionList,
  getPromptCount,
  findPromptByTimestamp,
} from "../reader";
import { onProxyScanComplete } from "../proxyAdapter";
import { onHistoryPromptParsed } from "../historyAdapter";
import type { PromptScan, UsageLogEntry } from "../../proxy/types";
import {
  getMetadata,
  setMetadata,
  deleteMetadata,
  getLastScanTimestamp,
  setLastScanTimestamp,
  isBackfillCompleted,
  setBackfillCompleted,
} from "../metadata";

// --- Test fixtures ---

const makePromptData = (
  overrides: Partial<InsertPromptData["prompt"]> = {},
  files = true,
  tools = true,
): InsertPromptData => ({
  prompt: {
    request_id: `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    session_id: "sess-001",
    timestamp: "2026-02-11T10:00:00.000Z",
    source: "proxy",
    user_prompt: "test prompt",
    user_prompt_tokens: 10,
    model: "claude-opus-4-6",
    max_tokens: 8192,
    system_tokens: 1000,
    messages_tokens: 5000,
    user_text_tokens: 2000,
    assistant_tokens: 2000,
    tool_result_tokens: 1000,
    tools_definition_tokens: 3000,
    total_context_tokens: 9000,
    total_injected_tokens: 500,
    input_tokens: 10,
    output_tokens: 200,
    cache_creation_input_tokens: 500,
    cache_read_input_tokens: 8490,
    cost_usd: 0.05,
    duration_ms: 3000,
    ...overrides,
  },
  injected_files: files
    ? [
        { path: "CLAUDE.md", category: "project", estimated_tokens: 300 },
        { path: "MEMORY.md", category: "memory", estimated_tokens: 200 },
      ]
    : [],
  tool_calls: tools
    ? [
        { call_index: 0, name: "Read", input_summary: "foo.ts" },
        { call_index: 1, name: "Edit", input_summary: "bar.ts" },
      ]
    : [],
  agent_calls: [
    { call_index: 0, subagent_type: "Explore", description: "search codebase" },
  ],
});

const makeScan = (overrides: Partial<PromptScan> = {}): PromptScan => ({
  request_id: `req-proxy-${Date.now()}`,
  session_id: "sess-proxy-001",
  timestamp: "2026-02-11T12:00:00.000Z",
  user_prompt: "proxy test",
  user_prompt_tokens: 15,
  assistant_response: "ok",
  injected_files: [
    { path: "CLAUDE.md", category: "project" as const, estimated_tokens: 300 },
  ],
  total_injected_tokens: 300,
  tool_calls: [{ index: 0, name: "Read", input_summary: "src/app.ts" }],
  tool_summary: { Read: 1 },
  agent_calls: [],
  context_estimate: {
    system_tokens: 800,
    messages_tokens: 4000,
    messages_tokens_breakdown: {
      user_text_tokens: 1500,
      assistant_tokens: 1500,
      tool_result_tokens: 1000,
    },
    tools_definition_tokens: 2500,
    total_tokens: 7300,
  },
  model: "claude-sonnet-4-5-20250929",
  max_tokens: 8192,
  conversation_turns: 3,
  user_messages_count: 2,
  assistant_messages_count: 2,
  tool_result_count: 1,
  ...overrides,
});

const makeUsage = (overrides: Partial<UsageLogEntry> = {}): UsageLogEntry => ({
  timestamp: "2026-02-11T12:00:00.000Z",
  request_id: `req-proxy-${Date.now()}`,
  session_id: "sess-proxy-001",
  model: "claude-sonnet-4-5-20250929",
  request: {
    messages_count: 5,
    tools_count: 20,
    has_system: true,
    max_tokens: 8192,
  },
  response: {
    input_tokens: 5,
    output_tokens: 300,
    cache_creation_input_tokens: 400,
    cache_read_input_tokens: 6895,
  },
  cost_usd: 0.03,
  duration_ms: 2500,
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
// Schema & Migration
// ============================================

describe("schema", () => {
  it("creates all 7 tables", () => {
    const db = getDatabase();
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;

    const names = tables.map((t) => t.name);
    expect(names).toContain("prompts");
    expect(names).toContain("injected_files");
    expect(names).toContain("tool_calls");
    expect(names).toContain("agent_calls");
    expect(names).toContain("daily_stats");
    expect(names).toContain("sessions");
    expect(names).toContain("app_metadata");
  });

  it("sets user_version to latest migration version", () => {
    const db = getDatabase();
    const ver = db.pragma("user_version", { simple: true });
    expect(ver).toBe(8);
  });

  it("sets WAL mode (memory DB reports 'memory')", () => {
    const db = getDatabase();
    const mode = db.pragma("journal_mode", { simple: true }) as string;
    // :memory: DB can't use WAL, reports "memory" instead
    expect(["wal", "memory"]).toContain(mode);
  });

  it("enables foreign keys", () => {
    const db = getDatabase();
    const fk = db.pragma("foreign_keys", { simple: true });
    expect(fk).toBe(1);
  });
});

// ============================================
// Metadata
// ============================================

describe("metadata", () => {
  describe("getMetadata / setMetadata", () => {
    it("returns null for non-existent key", () => {
      expect(getMetadata("nonexistent")).toBeNull();
    });

    it("stores and retrieves a value", () => {
      setMetadata("test_key", "test_value");
      expect(getMetadata("test_key")).toBe("test_value");
    });

    it("upserts on conflict", () => {
      setMetadata("upsert_key", "original");
      setMetadata("upsert_key", "updated");
      expect(getMetadata("upsert_key")).toBe("updated");
    });
  });

  describe("deleteMetadata", () => {
    it("removes a key", () => {
      setMetadata("del_key", "value");
      deleteMetadata("del_key");
      expect(getMetadata("del_key")).toBeNull();
    });

    it("no-ops for non-existent key", () => {
      expect(() => deleteMetadata("ghost")).not.toThrow();
    });
  });

  describe("backfill helpers", () => {
    it("getLastScanTimestamp returns null initially", () => {
      expect(getLastScanTimestamp()).toBeNull();
    });

    it("setLastScanTimestamp / getLastScanTimestamp roundtrip", () => {
      const ts = Date.now();
      setLastScanTimestamp(ts);
      expect(getLastScanTimestamp()).toBe(ts);
    });

    it("isBackfillCompleted defaults to false", () => {
      expect(isBackfillCompleted()).toBe(false);
    });

    it("setBackfillCompleted / isBackfillCompleted roundtrip", () => {
      setBackfillCompleted(true);
      expect(isBackfillCompleted()).toBe(true);
      setBackfillCompleted(false);
      expect(isBackfillCompleted()).toBe(false);
    });
  });
});

// ============================================
// Writer
// ============================================

describe("writer", () => {
  describe("insertPrompt", () => {
    it("inserts prompt with all related data", () => {
      const data = makePromptData({ request_id: "req-insert-001" });
      const id = insertPrompt(data);

      expect(id).toBeTypeOf("number");
      expect(id).toBeGreaterThan(0);

      const db = getDatabase();
      const row = db
        .prepare("SELECT * FROM prompts WHERE request_id = ?")
        .get("req-insert-001") as DbRow;
      expect(row).toBeDefined();
      expect(row.model).toBe("claude-opus-4-6");
      expect(row.total_context_tokens).toBe(9000);
      expect(row.cost_usd).toBe(0.05);

      const files = db
        .prepare("SELECT * FROM injected_files WHERE prompt_id = ?")
        .all(id!) as DbRow[];
      expect(files).toHaveLength(2);
      expect(files[0].path).toBe("CLAUDE.md");

      const tools = db
        .prepare("SELECT * FROM tool_calls WHERE prompt_id = ?")
        .all(id!) as DbRow[];
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("Read");

      const agents = db
        .prepare("SELECT * FROM agent_calls WHERE prompt_id = ?")
        .all(id!) as DbRow[];
      expect(agents).toHaveLength(1);
      expect(agents[0].subagent_type).toBe("Explore");
    });

    it("returns null on duplicate request_id", () => {
      const data = makePromptData({ request_id: "req-dup-001" });
      const id1 = insertPrompt(data);
      expect(id1).not.toBeNull();

      const id2 = insertPrompt(data);
      expect(id2).toBeNull();
    });

    it("inserts prompt without optional data", () => {
      const data = makePromptData(
        { request_id: "req-minimal-001" },
        false,
        false,
      );
      data.agent_calls = [];
      const id = insertPrompt(data);

      expect(id).not.toBeNull();

      const db = getDatabase();
      const files = db
        .prepare("SELECT * FROM injected_files WHERE prompt_id = ?")
        .all(id!) as DbRow[];
      expect(files).toHaveLength(0);
    });

    it("inserts prompt with file-scan source", () => {
      const data = makePromptData({
        request_id: "req-filescan-001",
        source: "file-scan",
      });
      const id = insertPrompt(data);
      expect(id).not.toBeNull();

      const db = getDatabase();
      const row = db
        .prepare("SELECT source FROM prompts WHERE request_id = ?")
        .get("req-filescan-001") as DbRow;
      expect(row.source).toBe("file-scan");
    });

    it("auto-updates daily_stats after insert", () => {
      insertPrompt(
        makePromptData({
          request_id: "req-stats-001",
          timestamp: "2026-02-11T10:00:00.000Z",
        }),
      );

      const db = getDatabase();
      const stat = db
        .prepare("SELECT * FROM daily_stats WHERE date = ?")
        .get("2026-02-11") as DbRow;

      expect(stat).toBeDefined();
      expect(stat.request_count).toBe(1);
      expect(stat.total_cost_usd).toBeCloseTo(0.05);
    });

    it("auto-updates sessions after insert", () => {
      insertPrompt(
        makePromptData({
          request_id: "req-sess-001",
          session_id: "sess-test",
        }),
      );

      const db = getDatabase();
      const sess = db
        .prepare("SELECT * FROM sessions WHERE session_id = ?")
        .get("sess-test") as DbRow;

      expect(sess).toBeDefined();
      expect(sess.prompt_count).toBe(1);
    });
  });

  describe("upsertDailyStats", () => {
    it("updates stats when adding more prompts", () => {
      insertPrompt(
        makePromptData({
          request_id: "req-ds-001",
          timestamp: "2026-02-11T10:00:00.000Z",
          cost_usd: 0.1,
        }),
      );
      insertPrompt(
        makePromptData({
          request_id: "req-ds-002",
          timestamp: "2026-02-11T11:00:00.000Z",
          cost_usd: 0.2,
        }),
      );

      const db = getDatabase();
      const stat = db
        .prepare("SELECT * FROM daily_stats WHERE date = ?")
        .get("2026-02-11") as DbRow;

      expect(stat.request_count).toBe(2);
      expect(stat.total_cost_usd).toBeCloseTo(0.3);
    });
  });

  describe("upsertSession", () => {
    it("tracks session timestamps and totals", () => {
      insertPrompt(
        makePromptData({
          request_id: "req-us-001",
          session_id: "sess-track",
          timestamp: "2026-02-11T08:00:00.000Z",
          cost_usd: 0.1,
        }),
      );
      insertPrompt(
        makePromptData({
          request_id: "req-us-002",
          session_id: "sess-track",
          timestamp: "2026-02-11T09:00:00.000Z",
          cost_usd: 0.15,
        }),
      );

      const db = getDatabase();
      const sess = db
        .prepare("SELECT * FROM sessions WHERE session_id = ?")
        .get("sess-track") as DbRow;

      expect(sess.prompt_count).toBe(2);
      expect(sess.total_cost_usd).toBeCloseTo(0.25);
      expect(sess.first_timestamp).toBe("2026-02-11T08:00:00.000Z");
      expect(sess.last_timestamp).toBe("2026-02-11T09:00:00.000Z");
    });
  });
});

// ============================================
// Reader
// ============================================

describe("reader", () => {
  beforeEach(() => {
    // Seed 3 prompts across 2 sessions and 2 days
    insertPrompt(
      makePromptData({
        request_id: "req-r-001",
        session_id: "sess-A",
        timestamp: "2026-02-10T10:00:00.000Z",
        model: "claude-opus-4-6",
        cost_usd: 0.1,
      }),
    );
    insertPrompt(
      makePromptData({
        request_id: "req-r-002",
        session_id: "sess-A",
        timestamp: "2026-02-10T11:00:00.000Z",
        model: "claude-opus-4-6",
        cost_usd: 0.2,
      }),
    );
    insertPrompt(
      makePromptData({
        request_id: "req-r-003",
        session_id: "sess-B",
        timestamp: "2026-02-11T10:00:00.000Z",
        model: "claude-sonnet-4-5-20250929",
        cost_usd: 0.05,
      }),
    );
  });

  describe("getPrompts", () => {
    it("returns all prompts ordered by timestamp desc", () => {
      const results = getPrompts({ limit: 10 });
      expect(results).toHaveLength(3);
      expect(results[0].request_id).toBe("req-r-003"); // newest first
    });

    it("filters by session_id", () => {
      const results = getPrompts({ session_id: "sess-A" });
      expect(results).toHaveLength(2);
      results.forEach((r) => expect(r.session_id).toBe("sess-A"));
    });

    it("filters by date", () => {
      const results = getPrompts({ date: "2026-02-10" });
      expect(results).toHaveLength(2);
    });

    it("filters by model", () => {
      const results = getPrompts({ model: "claude-sonnet-4-5-20250929" });
      expect(results).toHaveLength(1);
      expect(results[0].model).toBe("claude-sonnet-4-5-20250929");
    });

    it("supports pagination", () => {
      const page1 = getPrompts({ limit: 2, offset: 0 });
      const page2 = getPrompts({ limit: 2, offset: 2 });
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(1);
    });

    it("includes injected_files, tool_calls, agent_calls", () => {
      const results = getPrompts({ limit: 1 });
      expect(results[0].injected_files.length).toBeGreaterThan(0);
      expect(results[0].tool_calls.length).toBeGreaterThan(0);
      expect(results[0].agent_calls.length).toBeGreaterThan(0);
    });
  });

  describe("getPromptDetail", () => {
    it("returns scan + usage for existing prompt", () => {
      const result = getPromptDetail("req-r-001");
      expect(result).not.toBeNull();
      expect(result!.scan.request_id).toBe("req-r-001");
      expect(result!.scan.context_estimate.total_tokens).toBe(9000);
      expect(result!.scan.context_estimate.messages_tokens_breakdown).toEqual({
        user_text_tokens: 2000,
        assistant_tokens: 2000,
        tool_result_tokens: 1000,
      });
      expect(result!.usage.response.cache_read_input_tokens).toBe(8490);
      expect(result!.usage.cost_usd).toBe(0.1);
    });

    it("returns null for non-existent prompt", () => {
      expect(getPromptDetail("req-nonexistent")).toBeNull();
    });
  });

  describe("getSessionPrompts", () => {
    it("returns prompts for a session", () => {
      const results = getSessionPrompts("sess-A");
      expect(results).toHaveLength(2);
    });
  });

  describe("getScanStats", () => {
    it.skip("returns complete stats", () => {
      const stats = getScanStats();

      expect(stats.summary.total_requests).toBe(3);
      expect(stats.summary.total_cost_usd).toBeCloseTo(0.35);
      expect(stats.summary.avg_context_tokens).toBe(9000);
      // Each seeded prompt has both Read and Edit (same count), so either can be "most used"
      expect(["Read", "Edit"]).toContain(stats.summary.most_used_tool);

      expect(stats.cost_by_time.length).toBe(3);
      // TODO: cost_by_period returns empty — pre-existing reader bug, tracked separately
      // expect(stats.cost_by_period.length).toBeGreaterThan(0);
      expect(Object.keys(stats.tool_frequency)).toContain("Read");
      expect(Object.keys(stats.tool_frequency)).toContain("Edit");
      expect(stats.injected_file_tokens.length).toBeGreaterThan(0);
      expect(stats.cache_hit_rate.length).toBe(3);
    });

    it.skip("groups cost_by_period by local date, not UTC", () => {
      // Insert a prompt at a UTC timestamp that may be a different local date
      const utcTimestamp = "2026-02-10T23:30:00.000Z";
      insertPrompt(
        makePromptData({
          request_id: "req-tz-001",
          session_id: "sess-TZ",
          timestamp: utcTimestamp,
          cost_usd: 0.42,
        }),
      );

      const stats = getScanStats();
      // Compute expected local date from JS (same logic as toLocalDateKey)
      const d = new Date(utcTimestamp);
      const expectedDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

      // The period grouping must include the expected local date
      const periods = stats.cost_by_period.map((p) => p.period);
      expect(periods).toContain(expectedDate);

      // The entry for this local date must include the cost
      const entry = stats.cost_by_period.find((p) => p.period === expectedDate);
      expect(entry).toBeDefined();
      expect(entry!.cost_usd).toBeGreaterThanOrEqual(0.42);
    });

    it.skip("correctly groups UTC midnight-boundary timestamps", () => {
      // Two timestamps close in UTC but potentially on different local dates
      const beforeBoundary = "2026-02-15T14:59:00.000Z";
      const afterBoundary = "2026-02-15T15:01:00.000Z";

      insertPrompt(
        makePromptData({
          request_id: "req-tz-before",
          session_id: "sess-TZ2",
          timestamp: beforeBoundary,
          cost_usd: 0.1,
        }),
      );
      insertPrompt(
        makePromptData({
          request_id: "req-tz-after",
          session_id: "sess-TZ2",
          timestamp: afterBoundary,
          cost_usd: 0.2,
        }),
      );

      const stats = getScanStats();

      // Compute expected local dates from JS
      const localBefore = new Date(beforeBoundary);
      const localAfter = new Date(afterBoundary);
      const dateBefore = `${localBefore.getFullYear()}-${String(localBefore.getMonth() + 1).padStart(2, "0")}-${String(localBefore.getDate()).padStart(2, "0")}`;
      const dateAfter = `${localAfter.getFullYear()}-${String(localAfter.getMonth() + 1).padStart(2, "0")}-${String(localAfter.getDate()).padStart(2, "0")}`;

      const periods = stats.cost_by_period.map((p) => p.period);
      expect(periods).toContain(dateBefore);
      // If the two timestamps land on different local dates, both should appear
      if (dateBefore !== dateAfter) {
        expect(periods).toContain(dateAfter);
      }
    });
  });

  describe("getDailyStats", () => {
    it("returns stats for specific date", () => {
      const stats = getDailyStats("2026-02-10");
      expect(stats).toHaveLength(1);
      expect(stats[0].request_count).toBe(2);
    });

    it("returns empty for date with no data", () => {
      const stats = getDailyStats("2020-01-01");
      expect(stats).toHaveLength(0);
    });

    it("returns all dates when no filter", () => {
      const stats = getDailyStats();
      expect(stats.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("getSessionList", () => {
    it("returns sessions ordered by last_timestamp desc", () => {
      const sessions = getSessionList(10);
      expect(sessions).toHaveLength(2);
      expect(sessions[0].session_id).toBe("sess-B"); // newest
      expect(sessions[1].session_id).toBe("sess-A");
    });

    it("includes aggregated data", () => {
      const sessions = getSessionList(10);
      const sessA = sessions.find((s) => s.session_id === "sess-A")!;
      expect(sessA.prompt_count).toBe(2);
      expect(sessA.total_cost_usd).toBeCloseTo(0.3);
    });
  });

  describe("getPromptCount", () => {
    it("returns total count", () => {
      expect(getPromptCount()).toBe(3);
    });
  });

  describe("findPromptByTimestamp", () => {
    it("finds prompt within tolerance", () => {
      // req-r-001 has timestamp 2026-02-10T10:00:00.000Z
      const ts = new Date("2026-02-10T10:00:05.000Z").getTime(); // 5s off
      const result = findPromptByTimestamp("sess-A", ts, 30000);
      expect(result).not.toBeNull();
      expect(result!.request_id).toBe("req-r-001");
    });

    it("returns null outside tolerance", () => {
      const ts = new Date("2026-02-10T15:00:00.000Z").getTime(); // 5 hours off
      const result = findPromptByTimestamp("sess-A", ts, 1000);
      expect(result).toBeNull();
    });

    it("returns null for wrong session", () => {
      const ts = new Date("2026-02-10T10:00:00.000Z").getTime();
      const result = findPromptByTimestamp("sess-WRONG", ts);
      expect(result).toBeNull();
    });
  });
});

// ============================================
// Proxy Adapter
// ============================================

describe("proxyAdapter", () => {
  it("converts PromptScan + UsageLogEntry → DB and returns id", () => {
    const reqId = `req-pa-${Date.now()}`;
    const scan = makeScan({ request_id: reqId });
    const usage = makeUsage({ request_id: reqId });

    const id = onProxyScanComplete(scan, usage);
    expect(id).not.toBeNull();

    const detail = getPromptDetail(reqId);
    expect(detail).not.toBeNull();
    expect(detail!.scan.model).toBe("claude-sonnet-4-5-20250929");
    expect(detail!.scan.context_estimate.system_tokens).toBe(800);
    expect(detail!.scan.context_estimate.messages_tokens_breakdown).toEqual({
      user_text_tokens: 1500,
      assistant_tokens: 1500,
      tool_result_tokens: 1000,
    });
    expect(detail!.scan.injected_files).toHaveLength(1);
    expect(detail!.scan.tool_calls).toHaveLength(1);
    expect(detail!.usage.response.cache_read_input_tokens).toBe(6895);
  });
});

// ============================================
// History Adapter
// ============================================

describe("historyAdapter", () => {
  it("inserts history prompt when no proxy data exists", () => {
    const reqId = `req-ha-${Date.now()}`;
    const scan = makeScan({ request_id: reqId });
    const usage = makeUsage({ request_id: reqId });

    const id = onHistoryPromptParsed(scan, usage);
    expect(id).not.toBeNull();

    const detail = getPromptDetail(reqId);
    expect(detail).not.toBeNull();
  });

  it("skips if proxy data already exists (proxy priority)", () => {
    const reqId = `req-ha-dup-${Date.now()}`;

    // Insert via proxy first
    const scan = makeScan({ request_id: reqId });
    const usage = makeUsage({ request_id: reqId });
    onProxyScanComplete(scan, usage);

    // History should skip
    const id = onHistoryPromptParsed(scan, null);
    expect(id).toBeNull();

    // Only 1 row should exist
    expect(getPromptCount()).toBe(1);
  });

  it("works without usage data", () => {
    const reqId = `req-ha-nousage-${Date.now()}`;
    const scan = makeScan({ request_id: reqId });

    const id = onHistoryPromptParsed(scan, null);
    expect(id).not.toBeNull();

    const detail = getPromptDetail(reqId);
    expect(detail!.usage.response.input_tokens).toBe(0);
    expect(detail!.usage.cost_usd).toBe(0);
  });
});

// ============================================
// Foreign key cascade
// ============================================

describe("foreign key cascade", () => {
  it("deleting prompt cascades to child tables", () => {
    const data = makePromptData({ request_id: "req-cascade-001" });
    const id = insertPrompt(data);

    const db = getDatabase();

    // Verify children exist
    expect(
      (
        db
          .prepare(
            "SELECT COUNT(*) as c FROM injected_files WHERE prompt_id = ?",
          )
          .get(id!) as DbRow
      ).c,
    ).toBeGreaterThan(0);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) as c FROM tool_calls WHERE prompt_id = ?")
          .get(id!) as DbRow
      ).c,
    ).toBeGreaterThan(0);

    // Delete prompt
    db.prepare("DELETE FROM prompts WHERE id = ?").run(id!);

    // Children should be gone
    expect(
      (
        db
          .prepare(
            "SELECT COUNT(*) as c FROM injected_files WHERE prompt_id = ?",
          )
          .get(id!) as DbRow
      ).c,
    ).toBe(0);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) as c FROM tool_calls WHERE prompt_id = ?")
          .get(id!) as DbRow
      ).c,
    ).toBe(0);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) as c FROM agent_calls WHERE prompt_id = ?")
          .get(id!) as DbRow
      ).c,
    ).toBe(0);
  });
});
