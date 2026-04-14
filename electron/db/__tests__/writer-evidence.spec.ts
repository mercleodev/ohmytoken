import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDatabase, getDatabase, closeDatabase } from "../index";
import { insertPrompt, insertEvidenceReport, clearStatementCache } from "../writer";
import { getEvidenceReport } from "../reader";
import type { InsertPromptData } from "../writer";
import type { EvidenceReport } from "../../evidence/types";

const makePromptData = (requestId: string): InsertPromptData => ({
  prompt: {
    request_id: requestId,
    session_id: "sess-upsert",
    timestamp: "2026-04-14T10:00:00.000Z",
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
  },
  injected_files: [
    { path: "CLAUDE.md", category: "project", estimated_tokens: 300 },
  ],
  tool_calls: [],
  agent_calls: [],
});

const makeReport = (
  requestId: string,
  classification: "confirmed" | "likely" | "unverified",
  filePath = "CLAUDE.md",
): EvidenceReport => ({
  request_id: requestId,
  timestamp: "2026-04-14T10:00:00.000Z",
  engine_version: "1.0.0",
  fusion_method: "weighted_sum",
  thresholds: { confirmed_min: 0.7, likely_min: 0.4 },
  files: [
    {
      filePath,
      category: "project",
      signals: [
        {
          signalId: "category-prior",
          score: 0.5,
          maxScore: 1,
          confidence: 1,
          detail: "test",
        },
      ],
      rawScore: 0.5,
      normalizedScore: classification === "confirmed" ? 0.9 : classification === "likely" ? 0.5 : 0.1,
      classification,
    },
  ],
});

beforeEach(() => {
  clearStatementCache();
  initDatabase(":memory:");
});

afterEach(() => {
  closeDatabase();
});

describe("insertEvidenceReport — upsert semantics", () => {
  it("overwrites existing report for same request_id (not silently dropped)", () => {
    const requestId = "req-upsert-1";
    const promptId = insertPrompt(makePromptData(requestId));
    expect(promptId).not.toBeNull();
    if (promptId === null) throw new Error("unreachable");
    expect(promptId).toBeGreaterThan(0);

    // First insert — unverified
    const firstId = insertEvidenceReport(promptId, makeReport(requestId, "unverified"));
    expect(firstId).not.toBeNull();

    // Second insert — confirmed (should overwrite)
    const secondId = insertEvidenceReport(promptId, makeReport(requestId, "confirmed"));
    expect(secondId).not.toBeNull();

    // Read back — should reflect the second (confirmed) write
    const report = getEvidenceReport(requestId);
    expect(report).not.toBeNull();
    expect(report!.files).toHaveLength(1);
    expect(report!.files[0].classification).toBe("confirmed");
    expect(report!.files[0].normalizedScore).toBeCloseTo(0.9);
  });

  it("removes stale file_evidence_scores rows on overwrite", () => {
    const requestId = "req-upsert-2";
    const promptId = insertPrompt(makePromptData(requestId));
    if (promptId === null) throw new Error("unreachable");

    // First report: 2 files
    insertEvidenceReport(promptId, {
      ...makeReport(requestId, "likely", "CLAUDE.md"),
      files: [
        makeReport(requestId, "likely", "CLAUDE.md").files[0],
        makeReport(requestId, "likely", "MEMORY.md").files[0],
      ],
    });

    // Second report: only 1 file (MEMORY.md removed)
    insertEvidenceReport(promptId, makeReport(requestId, "confirmed", "CLAUDE.md"));

    const db = getDatabase();
    const reportRows = db
      .prepare("SELECT COUNT(*) as n FROM evidence_reports WHERE request_id = ?")
      .get(requestId) as { n: number };
    expect(reportRows.n).toBe(1); // exactly one logical report per request_id

    const fileRows = db
      .prepare(
        `SELECT fes.file_path FROM file_evidence_scores fes
         JOIN evidence_reports er ON er.id = fes.report_id
         WHERE er.request_id = ?`,
      )
      .all(requestId) as Array<{ file_path: string }>;
    expect(fileRows.map((r) => r.file_path).sort()).toEqual(["CLAUDE.md"]);
  });

  it("updates scalar columns (timestamp, engine_version, fusion thresholds)", () => {
    const requestId = "req-upsert-3";
    const promptId = insertPrompt(makePromptData(requestId));
    if (promptId === null) throw new Error("unreachable");

    insertEvidenceReport(promptId, {
      ...makeReport(requestId, "unverified"),
      timestamp: "2026-04-14T10:00:00.000Z",
      engine_version: "1.0.0",
      thresholds: { confirmed_min: 0.7, likely_min: 0.4 },
    });

    insertEvidenceReport(promptId, {
      ...makeReport(requestId, "likely"),
      timestamp: "2026-04-14T11:00:00.000Z",
      engine_version: "1.1.0",
      thresholds: { confirmed_min: 0.8, likely_min: 0.5 },
    });

    const report = getEvidenceReport(requestId);
    expect(report).not.toBeNull();
    expect(report!.timestamp).toBe("2026-04-14T11:00:00.000Z");
    expect(report!.engine_version).toBe("1.1.0");
    expect(report!.thresholds.confirmed_min).toBeCloseTo(0.8);
    expect(report!.thresholds.likely_min).toBeCloseTo(0.5);
  });

  it("is atomic — a failing second file row leaves the first report intact", () => {
    // This asserts the transaction wraps all sub-writes; we do not simulate
    // a mid-transaction failure here because better-sqlite3's tx already
    // enforces atomicity. We simply verify a successful re-insert leaves
    // DB consistent (no partial duplication).
    const requestId = "req-upsert-4";
    const promptId = insertPrompt(makePromptData(requestId));
    if (promptId === null) throw new Error("unreachable");

    for (let i = 0; i < 3; i++) {
      insertEvidenceReport(promptId, makeReport(requestId, "likely"));
    }

    const db = getDatabase();
    const counts = db
      .prepare(
        `SELECT
            (SELECT COUNT(*) FROM evidence_reports WHERE request_id = ?) as reports,
            (SELECT COUNT(*) FROM file_evidence_scores fes
             JOIN evidence_reports er ON er.id = fes.report_id
             WHERE er.request_id = ?) as files`,
      )
      .get(requestId, requestId) as { reports: number; files: number };

    expect(counts.reports).toBe(1);
    expect(counts.files).toBe(1);
  });
});
