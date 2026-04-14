import { describe, it, expect } from 'vitest';
import type { PromptNotification } from '../types';
import type { EvidenceReport } from '../../../types/electron';
import { mergeEvidenceReport } from '../mergeEvidence';

// Minimal fixture — only the fields mergeEvidenceReport touches.
const makeNotif = (id: string): PromptNotification =>
  ({
    id,
    scan: {
      request_id: id,
      session_id: 'sess-1',
      timestamp: '2026-04-14T10:00:00.000Z',
      user_prompt: 'q',
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
      model: 'claude-opus-4-6',
      max_tokens: 8192,
      conversation_turns: 1,
      user_messages_count: 1,
      assistant_messages_count: 0,
      tool_result_count: 0,
      provider: 'claude',
      // evidence_report intentionally omitted
    },
    usage: null,
    status: 'completed',
    createdAt: 0,
    completedAt: 0,
    turnMetrics: [],
    alerts: [],
    activityLog: [],
  }) as PromptNotification;

const makeReport = (requestId: string): EvidenceReport => ({
  request_id: requestId,
  timestamp: '2026-04-14T10:00:01.000Z',
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

describe('mergeEvidenceReport', () => {
  it('attaches the report to the notification whose request_id matches', () => {
    const a = makeNotif('req-a');
    const b = makeNotif('req-b');
    const report = makeReport('req-b');

    const next = mergeEvidenceReport([a, b], {
      requestId: 'req-b',
      report,
    });

    expect(next[0].scan.evidence_report).toBeUndefined();
    expect(next[1].scan.evidence_report).toEqual(report);
  });

  it('returns the same list reference when no notification matches (identity, no churn)', () => {
    const a = makeNotif('req-a');
    const list = [a];
    const next = mergeEvidenceReport(list, {
      requestId: 'req-missing',
      report: makeReport('req-missing'),
    });
    expect(next).toBe(list);
  });

  it('is pure — does not mutate the input notifications', () => {
    const a = makeNotif('req-a');
    const originalScan = a.scan;
    const report = makeReport('req-a');

    const next = mergeEvidenceReport([a], {
      requestId: 'req-a',
      report,
    });

    expect(a.scan).toBe(originalScan);
    expect(a.scan.evidence_report).toBeUndefined();
    expect(next[0]).not.toBe(a);
    expect(next[0].scan).not.toBe(originalScan);
    expect(next[0].scan.evidence_report).toEqual(report);
  });

  it('overwrites an existing evidence_report when a fresh one arrives', () => {
    const a = makeNotif('req-a');
    const oldReport = makeReport('req-a');
    oldReport.engine_version = '0.9.0';
    a.scan.evidence_report = oldReport;

    const freshReport = makeReport('req-a');
    freshReport.engine_version = '1.1.0';

    const next = mergeEvidenceReport([a], {
      requestId: 'req-a',
      report: freshReport,
    });

    expect(next[0].scan.evidence_report?.engine_version).toBe('1.1.0');
  });
});
