import { describe, it, expect } from 'vitest';
import type { PromptScan, UsageLogEntry, TurnMetric, SessionMcpAnalysis } from '../../../types/electron';
import type { PromptNotification } from '../types';
import type { GuardrailAssessment } from '../../../guardrails/types';
import { buildContext } from '../../../guardrails/buildContext';
import { evaluate } from '../../../guardrails/engine';
import { MVP_RULES } from '../../../guardrails/rules';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseScan: PromptScan = {
  request_id: 'req-1',
  session_id: 'sess-1',
  timestamp: '2026-03-29T12:00:00Z',
  user_prompt: 'test prompt',
  user_prompt_tokens: 100,
  injected_files: [],
  total_injected_tokens: 0,
  tool_calls: [],
  tool_summary: {},
  agent_calls: [],
  context_estimate: {
    system_tokens: 1000,
    messages_tokens: 2000,
    tools_definition_tokens: 500,
    total_tokens: 3500,
  },
  model: 'claude-sonnet-4-5-20250929',
  max_tokens: 16384,
  conversation_turns: 3,
  user_messages_count: 3,
  assistant_messages_count: 3,
  tool_result_count: 0,
  provider: 'claude',
};

const baseUsage: UsageLogEntry = {
  timestamp: '2026-03-29T12:00:00Z',
  request_id: 'req-1',
  session_id: 'sess-1',
  model: 'claude-sonnet-4-5-20250929',
  request: {
    messages_count: 6,
    tools_count: 0,
    has_system: true,
    max_tokens: 16384,
  },
  response: {
    input_tokens: 1000,
    output_tokens: 500,
    cache_creation_input_tokens: 200,
    cache_read_input_tokens: 300,
  },
  cost_usd: 0.01,
  duration_ms: 2000,
};

function makeTurnMetric(overrides: Partial<TurnMetric> & { turnIndex: number }): TurnMetric {
  return {
    timestamp: '2026-03-29T12:00:00Z',
    request_id: `req-${overrides.turnIndex}`,
    cache_read_tokens: 0,
    cache_create_tokens: 0,
    input_tokens: 1000,
    output_tokens: 500,
    total_context_tokens: 3500,
    cost_usd: 0.01,
    ...overrides,
  };
}

const emptyMcp: SessionMcpAnalysis = {
  totalToolCalls: 0,
  mcpCalls: 0,
  toolResultTokens: 0,
  toolBreakdown: {},
  redundantPatterns: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Guardrail Integration with PromptNotification', () => {
  it('PromptNotification type accepts guardrailAssessment field', () => {
    const assessment: GuardrailAssessment = {
      generatedAt: new Date().toISOString(),
      primary: null,
      secondary: [],
      all: [],
      summary: { sessionHealth: 'healthy', topRiskIds: [] },
    };

    const notif: PromptNotification = {
      id: 'test-1',
      scan: baseScan,
      usage: baseUsage,
      status: 'completed',
      createdAt: Date.now(),
      completedAt: Date.now(),
      turnMetrics: [],
      alerts: [],
      activityLog: [],
      guardrailAssessment: assessment,
    };

    expect(notif.guardrailAssessment).toBeDefined();
    expect(notif.guardrailAssessment?.summary.sessionHealth).toBe('healthy');
  });

  it('builds guardrail context and computes assessment from batch IPC data', () => {
    const turnMetrics: TurnMetric[] = [
      makeTurnMetric({ turnIndex: 0, total_context_tokens: 160000 }),
      makeTurnMetric({ turnIndex: 1, total_context_tokens: 170000 }),
      makeTurnMetric({ turnIndex: 2, total_context_tokens: 180000 }),
    ];

    // Simulate batch IPC response
    const batchResponse = { turnMetrics, mcpAnalysis: emptyMcp };

    // Build context (what addNotification should do)
    const ctx = buildContext(baseScan, baseUsage, batchResponse.turnMetrics, batchResponse.mcpAnalysis);
    const assessment = evaluate(ctx, MVP_RULES);

    expect(assessment).toBeDefined();
    expect(assessment.generatedAt).toBeTruthy();
    expect(assessment.summary.sessionHealth).toBeDefined();
    expect(['healthy', 'watch', 'risky']).toContain(assessment.summary.sessionHealth);
  });

  it('produces healthy assessment when session metrics are normal', () => {
    const turnMetrics: TurnMetric[] = [
      makeTurnMetric({ turnIndex: 0, total_context_tokens: 10000 }),
      makeTurnMetric({ turnIndex: 1, total_context_tokens: 12000 }),
    ];

    const ctx = buildContext(baseScan, baseUsage, turnMetrics, emptyMcp);
    const assessment = evaluate(ctx, MVP_RULES);

    expect(assessment.primary).toBeNull();
    expect(assessment.secondary).toHaveLength(0);
    expect(assessment.summary.sessionHealth).toBe('healthy');
  });

  it('fires compact-now when context is high', () => {
    // 170000 / 200000 = 85% > 80% threshold
    const highContextScan: PromptScan = {
      ...baseScan,
      context_estimate: { ...baseScan.context_estimate, total_tokens: 170000 },
    };
    const turnMetrics: TurnMetric[] = [
      makeTurnMetric({ turnIndex: 0, total_context_tokens: 150000 }),
      makeTurnMetric({ turnIndex: 1, total_context_tokens: 170000 }),
    ];

    const ctx = buildContext(highContextScan, baseUsage, turnMetrics, emptyMcp);
    const assessment = evaluate(ctx, MVP_RULES);

    expect(assessment.primary).not.toBeNull();
    expect(assessment.primary?.id).toBe('compact-now');
    expect(assessment.summary.sessionHealth).not.toBe('healthy');
  });

  it('attaches assessment to notification object correctly', () => {
    const turnMetrics: TurnMetric[] = [
      makeTurnMetric({ turnIndex: 0, total_context_tokens: 10000 }),
    ];
    const ctx = buildContext(baseScan, baseUsage, turnMetrics, emptyMcp);
    const assessment = evaluate(ctx, MVP_RULES);

    // Simulate what addNotification does
    const notif: PromptNotification = {
      id: baseScan.request_id,
      scan: baseScan,
      usage: baseUsage,
      status: 'completed',
      createdAt: Date.now(),
      completedAt: Date.now(),
      turnMetrics,
      alerts: [],
      activityLog: [],
      guardrailAssessment: assessment,
    };

    expect(notif.guardrailAssessment).toBe(assessment);
    expect(notif.alerts).toEqual([]); // Legacy alerts still present
  });

  it('handles empty batch response gracefully (no assessment)', () => {
    const ctx = buildContext(baseScan, baseUsage, [], undefined);
    const assessment = evaluate(ctx, MVP_RULES);

    // No turn data → healthy
    expect(assessment.summary.sessionHealth).toBe('healthy');

    const notif: PromptNotification = {
      id: baseScan.request_id,
      scan: baseScan,
      usage: baseUsage,
      status: 'completed',
      createdAt: Date.now(),
      completedAt: Date.now(),
      turnMetrics: [],
      alerts: [],
      activityLog: [],
      guardrailAssessment: assessment,
    };

    expect(notif.guardrailAssessment?.summary.sessionHealth).toBe('healthy');
  });

  it('preserves legacy alerts alongside guardrail assessment', () => {
    const notif: PromptNotification = {
      id: 'test-compat',
      scan: baseScan,
      usage: baseUsage,
      status: 'completed',
      createdAt: Date.now(),
      completedAt: Date.now(),
      turnMetrics: [],
      alerts: [{ id: 'cache-1', type: 'cache_explosion', severity: 'warning', message: 'Cache usage is very high', tip: 'Consider compacting' }],
      activityLog: [],
      guardrailAssessment: {
        generatedAt: new Date().toISOString(),
        primary: null,
        secondary: [],
        all: [],
        summary: { sessionHealth: 'healthy', topRiskIds: [] },
      },
    };

    // Both alerts and guardrailAssessment should coexist
    expect(notif.alerts).toHaveLength(1);
    expect(notif.guardrailAssessment).toBeDefined();
  });
});
