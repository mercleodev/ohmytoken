import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDatabase, closeDatabase } from "../index";
import {
  insertPrompt,
  insertEvidenceReport,
  clearStatementCache,
} from "../writer";
import { getPromptDetail, getPromptIdByRequestId, getPrompts } from "../reader";
import type { InsertPromptData } from "../writer";
import type { EvidenceReport } from "../../evidence/types";

const makePromptData = (requestId: string): InsertPromptData => ({
  prompt: {
    request_id: requestId,
    session_id: "sess-reader",
    timestamp: "2026-04-14T10:00:00.000Z",
    source: "proxy",
    user_prompt: "reader test",
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

const makeReport = (requestId: string): EvidenceReport => ({
  request_id: requestId,
  timestamp: "2026-04-14T10:00:00.000Z",
  engine_version: "1.0.0",
  fusion_method: "weighted_sum",
  thresholds: { confirmed_min: 0.7, likely_min: 0.4 },
  files: [
    {
      filePath: "CLAUDE.md",
      category: "project",
      signals: [],
      rawScore: 0.6,
      normalizedScore: 0.6,
      classification: "likely",
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

describe("getPromptDetail — evidence_report attach", () => {
  it("attaches scan.evidence_report when one exists in DB", () => {
    const requestId = "req-attach-1";
    const promptId = insertPrompt(makePromptData(requestId));
    if (promptId === null) throw new Error("unreachable");
    insertEvidenceReport(promptId, makeReport(requestId));

    const detail = getPromptDetail(requestId);
    expect(detail).not.toBeNull();
    expect(detail!.scan.evidence_report).toBeDefined();
    expect(detail!.scan.evidence_report!.request_id).toBe(requestId);
    expect(detail!.scan.evidence_report!.files).toHaveLength(1);
    expect(detail!.scan.evidence_report!.files[0].classification).toBe(
      "likely",
    );
  });

  it("leaves scan.evidence_report undefined when no report exists", () => {
    const requestId = "req-attach-2";
    const promptId = insertPrompt(makePromptData(requestId));
    if (promptId === null) throw new Error("unreachable");

    const detail = getPromptDetail(requestId);
    expect(detail).not.toBeNull();
    expect(detail!.scan.evidence_report).toBeUndefined();
  });

  it("does NOT attach evidence_report to getPrompts (list) — no N+1", () => {
    const requestId = "req-attach-3";
    const promptId = insertPrompt(makePromptData(requestId));
    if (promptId === null) throw new Error("unreachable");
    insertEvidenceReport(promptId, makeReport(requestId));

    const list = getPrompts({ limit: 10 });
    const found = list.find((p) => p.request_id === requestId);
    expect(found).toBeDefined();
    // list queries must not carry evidence_report (performance contract)
    expect(found!.evidence_report).toBeUndefined();
  });
});

describe("getPromptIdByRequestId", () => {
  it("returns the numeric prompt id for a known request_id", () => {
    const requestId = "req-id-lookup-1";
    const promptId = insertPrompt(makePromptData(requestId));
    expect(promptId).not.toBeNull();

    const result = getPromptIdByRequestId(requestId);
    expect(result).toBe(promptId);
  });

  it("returns null for an unknown request_id", () => {
    const result = getPromptIdByRequestId("does-not-exist");
    expect(result).toBeNull();
  });
});
