import { describe, it, expect } from 'vitest';
import { resolveEvidenceView } from '../pendingEvidence';
import type { PromptScan, EvidenceReport } from '../../../types/electron';

const makeScan = (withReport?: EvidenceReport): PromptScan =>
  ({
    request_id: 'req-1',
    session_id: 'sess-1',
    timestamp: '2026-04-14T10:00:00.000Z',
    user_prompt: 'q',
    user_prompt_tokens: 0,
    injected_files: [
      { path: 'CLAUDE.md', category: 'project', estimated_tokens: 300 },
    ],
    total_injected_tokens: 300,
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
    model: 'x',
    max_tokens: 8192,
    conversation_turns: 1,
    user_messages_count: 1,
    assistant_messages_count: 0,
    tool_result_count: 0,
    provider: 'claude',
    evidence_report: withReport,
  }) as PromptScan;

const makeReport = (): EvidenceReport => ({
  request_id: 'req-1',
  timestamp: 't',
  engine_version: '1.0.0',
  fusion_method: 'weighted_sum',
  thresholds: { confirmed_min: 0.7, likely_min: 0.4 },
  files: [
    {
      filePath: 'CLAUDE.md',
      category: 'project',
      signals: [],
      rawScore: 0.6,
      normalizedScore: 0.6,
      classification: 'likely',
    },
  ],
});

describe('resolveEvidenceView — G2-C.1 caller-level contract', () => {
  it('returns "scored" when scan.evidence_report is attached (skip pending, skip legacy)', () => {
    const view = resolveEvidenceView({
      scan: makeScan(makeReport()),
      pendingTimedOut: false,
      ageMs: 500,
    });
    expect(view.kind).toBe('scored');
  });

  it('returns "pending" when no report yet AND pending window has not elapsed', () => {
    const view = resolveEvidenceView({
      scan: makeScan(),
      pendingTimedOut: false,
      ageMs: 2_000,
    });
    expect(view.kind).toBe('pending');
  });

  it('returns "legacy" (falls through to buildInjectedEvidence) when pending timed out and still no report', () => {
    const view = resolveEvidenceView({
      scan: makeScan(),
      pendingTimedOut: true,
      ageMs: 10_000,
    });
    expect(view.kind).toBe('legacy');
  });

  it('an arriving report after timeout still renders "scored" (late arrival wins)', () => {
    const view = resolveEvidenceView({
      scan: makeScan(makeReport()),
      pendingTimedOut: true,
      ageMs: 10_000,
    });
    expect(view.kind).toBe('scored');
  });
});
