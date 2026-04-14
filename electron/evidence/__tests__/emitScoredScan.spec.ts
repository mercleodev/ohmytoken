import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeEmitScoredScan } from "../emitScoredScan";
import type { EvidenceReport } from "../types";
import type { PromptScan, UsageLogEntry } from "../../proxy/types";

// --- Fixtures ---

const makeScan = (requestId: string, evidenceReport?: EvidenceReport): PromptScan =>
  ({
    request_id: requestId,
    session_id: "sess-1",
    timestamp: "2026-04-14T10:00:00.000Z",
    user_prompt: "q",
    user_prompt_tokens: 0,
    injected_files: [],
    total_injected_tokens: 0,
    tool_calls: [],
    tool_summary: {},
    agent_calls: [],
    context_estimate: {
      system_tokens: 0,
      messages_tokens: 0,
      messages_tokens_breakdown: {
        user_text_tokens: 0,
        assistant_tokens: 0,
        tool_result_tokens: 0,
      },
      tools_definition_tokens: 0,
      total_tokens: 0,
    },
    model: "claude-opus-4-6",
    max_tokens: 8192,
    conversation_turns: 1,
    user_messages_count: 1,
    assistant_messages_count: 0,
    tool_result_count: 0,
    provider: "claude",
    evidence_report: evidenceReport,
  }) as PromptScan;

const makeUsage = (): UsageLogEntry =>
  ({
    timestamp: "2026-04-14T10:00:00.000Z",
    request_id: "x",
    session_id: "sess-1",
    model: "claude-opus-4-6",
    request: { messages_count: 0, tools_count: 0, has_system: false, max_tokens: 8192 },
    response: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    cost_usd: 0,
    duration_ms: 0,
  }) as UsageLogEntry;

const makeReport = (requestId: string, engineVersion = "1.0.0"): EvidenceReport => ({
  request_id: requestId,
  timestamp: "2026-04-14T10:00:00.000Z",
  engine_version: engineVersion,
  fusion_method: "weighted_sum",
  thresholds: { confirmed_min: 0.7, likely_min: 0.4 },
  files: [
    {
      filePath: "CLAUDE.md",
      category: "project",
      signals: [],
      rawScore: 0.5,
      normalizedScore: 0.5,
      classification: "likely",
    },
  ],
});

type Deps = Parameters<typeof makeEmitScoredScan>[0];

const makeDeps = (overrides: Partial<Deps> = {}): Deps => ({
  reader: {
    getPromptDetail: vi.fn(),
    getEvidenceReport: vi.fn(() => null),
    getPromptIdByRequestId: vi.fn(() => null),
    getSessionFileScores: vi.fn(() => ({})),
  },
  writer: {
    insertEvidenceReport: vi.fn(() => 1),
  },
  engine: null,
  sendToMain: vi.fn(),
  sendToNotification: vi.fn(),
  logger: { error: vi.fn() },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("emitScoredScan", () => {
  it("no-op when prompt detail not found", () => {
    const deps = makeDeps({
      reader: {
        getPromptDetail: vi.fn(() => null),
        getEvidenceReport: vi.fn(() => null),
        getPromptIdByRequestId: vi.fn(() => null),
        getSessionFileScores: vi.fn(() => ({})),
      },
    });
    const emit = makeEmitScoredScan(deps);
    emit("req-x", "session");
    expect(deps.sendToMain).not.toHaveBeenCalled();
    expect(deps.sendToNotification).not.toHaveBeenCalled();
    expect(deps.writer.insertEvidenceReport).not.toHaveBeenCalled();
  });

  it("(branch 1) no existing report → scoring runs, DB insert fires, emitted payload carries evidence_report", () => {
    const scan = makeScan("req-a");
    const usage = makeUsage();
    const freshReport = makeReport("req-a");

    const engine = { score: vi.fn(() => freshReport) };

    const deps = makeDeps({
      reader: {
        getPromptDetail: vi.fn(() => ({ scan, usage })),
        getEvidenceReport: vi.fn(() => null),
        getPromptIdByRequestId: vi.fn(() => 42),
        getSessionFileScores: vi.fn(() => ({ "CLAUDE.md": [0.3] })),
      },
      engine,
    });

    const emit = makeEmitScoredScan(deps);
    emit("req-a", "session");

    expect(engine.score).toHaveBeenCalledTimes(1);
    expect(engine.score).toHaveBeenCalledWith(
      expect.objectContaining({ request_id: "req-a" }),
      { previousScores: { "CLAUDE.md": [0.3] } },
    );
    expect(deps.writer.insertEvidenceReport).toHaveBeenCalledWith(42, freshReport);
    expect(deps.sendToNotification).toHaveBeenCalledWith("new-prompt-scan", {
      scan: expect.objectContaining({
        request_id: "req-a",
        evidence_report: freshReport,
      }),
      usage,
    });
    expect(deps.sendToMain).toHaveBeenCalledWith("new-prompt-scan", expect.any(Object));
  });

  it("(branch 2, anti-downgrade) existing report → scoring is NOT invoked, DB insert is NOT called, emitted payload carries the stored report", () => {
    const existingReport = makeReport("req-b", "1.0.0-proxy");
    const scan = makeScan("req-b"); // detail without evidence_report attached yet
    const usage = makeUsage();

    const engine = { score: vi.fn() };

    const deps = makeDeps({
      reader: {
        getPromptDetail: vi.fn(() => ({ scan, usage })),
        getEvidenceReport: vi.fn(() => existingReport), // proxy path already persisted
        getPromptIdByRequestId: vi.fn(() => 42),
        getSessionFileScores: vi.fn(() => ({})),
      },
      engine,
    });

    const emit = makeEmitScoredScan(deps);
    emit("req-b", "session");

    expect(engine.score).not.toHaveBeenCalled();
    expect(deps.writer.insertEvidenceReport).not.toHaveBeenCalled();
    expect(deps.sendToNotification).toHaveBeenCalledWith("new-prompt-scan", {
      scan: expect.objectContaining({
        request_id: "req-b",
        evidence_report: existingReport,
      }),
      usage,
    });
  });

  it("(branch 3) scoring throws → payload is still emitted (without evidence_report) and the error is logged", () => {
    const scan = makeScan("req-c");
    const usage = makeUsage();

    const engine = {
      score: vi.fn(() => {
        throw new Error("boom");
      }),
    };

    const deps = makeDeps({
      reader: {
        getPromptDetail: vi.fn(() => ({ scan, usage })),
        getEvidenceReport: vi.fn(() => null),
        getPromptIdByRequestId: vi.fn(() => 42),
        getSessionFileScores: vi.fn(() => ({})),
      },
      engine,
    });

    const emit = makeEmitScoredScan(deps);
    emit("req-c", "codex");

    expect(deps.writer.insertEvidenceReport).not.toHaveBeenCalled();
    expect(deps.logger?.error).toHaveBeenCalled();
    expect(deps.sendToNotification).toHaveBeenCalledWith("new-prompt-scan", {
      scan: expect.objectContaining({
        request_id: "req-c",
        // evidence_report should be undefined on the payload
      }),
      usage,
    });
    const notifCall = (deps.sendToNotification as ReturnType<typeof vi.fn>).mock.calls[0];
    const [, emittedPayload] = notifCall;
    expect(emittedPayload.scan.evidence_report).toBeUndefined();
  });

  it("skips scoring when engine is null (no engine available)", () => {
    const scan = makeScan("req-d");
    const usage = makeUsage();

    const deps = makeDeps({
      reader: {
        getPromptDetail: vi.fn(() => ({ scan, usage })),
        getEvidenceReport: vi.fn(() => null),
        getPromptIdByRequestId: vi.fn(() => null),
        getSessionFileScores: vi.fn(() => ({})),
      },
      engine: null,
    });

    const emit = makeEmitScoredScan(deps);
    emit("req-d", "history");

    expect(deps.writer.insertEvidenceReport).not.toHaveBeenCalled();
    // Still emits the scan so the notification card renders — pending state
    // will handle the "no report yet" UI in PR-5.
    expect(deps.sendToNotification).toHaveBeenCalledWith("new-prompt-scan", {
      scan: expect.objectContaining({ request_id: "req-d" }),
      usage,
    });
  });
});
