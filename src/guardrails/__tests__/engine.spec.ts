import { describe, it, expect } from 'vitest';
import type { PromptScan, UsageLogEntry, TurnMetric, SessionMcpAnalysis, EvidenceReport } from '../../types/electron';
import type { GuardrailContext, GuardrailRule } from '../types';
import {
  CONTEXT_WARN_PCT,
  CONTEXT_CRITICAL_PCT,
  LONG_SESSION_TURNS,
  DEFAULT_CONTEXT_LIMIT,
  getContextLimit,
} from '../constants';
import { buildContext } from '../buildContext';
import { evaluate } from '../engine';
import { compactNowRule } from '../rules/compactNow';
import { toolLoopRule } from '../rules/toolLoop';
import { splitSessionRule } from '../rules/splitSession';
import { cacheExplosionRule } from '../rules/cacheExplosion';
import { lowValueInjectedFilesRule } from '../rules/lowValueInjectedFiles';
import { MVP_RULES } from '../rules';

// ---------------------------------------------------------------------------
// Test helpers — minimal fixtures
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
    input_tokens: 5000,
    output_tokens: 1000,
    cache_creation_input_tokens: 500,
    cache_read_input_tokens: 3000,
  },
  cost_usd: 0.05,
  duration_ms: 2000,
};

const makeTurnMetric = (overrides: Partial<TurnMetric> & { turnIndex: number }): TurnMetric => ({
  timestamp: '2026-03-29T12:00:00Z',
  request_id: `req-${overrides.turnIndex}`,
  cache_read_tokens: 0,
  cache_create_tokens: 0,
  input_tokens: 1000,
  output_tokens: 500,
  total_context_tokens: 5000,
  cost_usd: 0.01,
  ...overrides,
});

const emptyMcp: SessionMcpAnalysis = {
  totalToolCalls: 0,
  mcpCalls: 0,
  toolResultTokens: 0,
  toolBreakdown: {},
  redundantPatterns: [],
};

// ---------------------------------------------------------------------------
// constants.ts
// ---------------------------------------------------------------------------

describe('constants', () => {
  it('exports threshold constants', () => {
    expect(CONTEXT_WARN_PCT).toBe(0.80);
    expect(CONTEXT_CRITICAL_PCT).toBe(0.90);
    expect(LONG_SESSION_TURNS).toBe(12);
    expect(DEFAULT_CONTEXT_LIMIT).toBe(200_000);
  });

  describe('getContextLimit', () => {
    it('returns known model limit', () => {
      expect(getContextLimit('claude-sonnet-4-5-20250929')).toBe(200_000);
    });

    it('returns default for unknown model', () => {
      expect(getContextLimit('unknown-model-xyz')).toBe(DEFAULT_CONTEXT_LIMIT);
    });

    it('returns correct limit for gemini models', () => {
      expect(getContextLimit('gemini-2.5-pro')).toBe(1_048_576);
    });

    it('returns correct limit for codex models', () => {
      expect(getContextLimit('gpt-5.3-codex')).toBe(258_400);
    });
  });
});

// ---------------------------------------------------------------------------
// buildContext.ts
// ---------------------------------------------------------------------------

describe('buildContext', () => {
  it('builds context from scan + usage + turnMetrics', () => {
    const metrics: TurnMetric[] = [
      makeTurnMetric({ turnIndex: 0, output_tokens: 400, total_context_tokens: 3000, cost_usd: 0.01 }),
      makeTurnMetric({ turnIndex: 1, output_tokens: 600, total_context_tokens: 4000, cost_usd: 0.02 }),
      makeTurnMetric({ turnIndex: 2, output_tokens: 500, total_context_tokens: 5000, cost_usd: 0.03 }),
    ];

    const ctx = buildContext(baseScan, baseUsage, metrics);

    expect(ctx.scan).toBe(baseScan);
    expect(ctx.usage).toBe(baseUsage);
    expect(ctx.turnMetrics).toBe(metrics);
    expect(ctx.contextLimit).toBe(200_000);
    expect(ctx.sessionCompactions).toBe(0);

    // Derived values
    expect(ctx.derived.turnCount).toBe(3);
    expect(ctx.derived.currentContextTokens).toBe(5000);
    expect(ctx.derived.currentContextPct).toBeCloseTo(5000 / 200_000);
    expect(ctx.derived.latestTurnCostUsd).toBe(0.03);
    expect(ctx.derived.latestOutputTokens).toBe(500);
    expect(ctx.derived.sessionCostUsd).toBeCloseTo(0.06);
  });

  it('handles null usage gracefully', () => {
    const metrics = [makeTurnMetric({ turnIndex: 0 })];
    const ctx = buildContext(baseScan, null, metrics);

    expect(ctx.usage).toBeNull();
    expect(ctx.derived.latestOutputTokens).toBe(500); // from turnMetrics
    expect(ctx.derived.sessionCostUsd).toBe(0.01);
  });

  it('handles empty turnMetrics', () => {
    const ctx = buildContext(baseScan, baseUsage, []);

    expect(ctx.derived.turnCount).toBe(0);
    expect(ctx.derived.currentContextTokens).toBe(0);
    expect(ctx.derived.currentContextPct).toBe(0);
    expect(ctx.derived.latestTurnCostUsd).toBe(0);
    expect(ctx.derived.latestOutputTokens).toBe(0);
    expect(ctx.derived.sessionCostUsd).toBe(0);
    expect(ctx.derived.last3OutputRatio).toBeNull();
    expect(ctx.derived.avgTurnCostUsd).toBeNull();
    expect(ctx.derived.medianTurnCostUsd).toBeNull();
  });

  it('computes sessionCacheReadPct correctly', () => {
    const metrics = [
      makeTurnMetric({ turnIndex: 0, cache_read_tokens: 8000, input_tokens: 1000, output_tokens: 500, cache_create_tokens: 500 }),
      makeTurnMetric({ turnIndex: 1, cache_read_tokens: 9000, input_tokens: 500, output_tokens: 300, cache_create_tokens: 200 }),
    ];
    const ctx = buildContext(baseScan, baseUsage, metrics);

    // Total tokens = (8000+1000+500+500) + (9000+500+300+200) = 10000 + 10000 = 20000
    // Cache read = 8000 + 9000 = 17000
    expect(ctx.derived.sessionCacheReadPct).toBeCloseTo(17000 / 20000);
  });

  it('computes last3OutputRatio correctly', () => {
    const metrics = [
      makeTurnMetric({ turnIndex: 0, output_tokens: 100, input_tokens: 9000, cache_read_tokens: 0, cache_create_tokens: 0 }),
      makeTurnMetric({ turnIndex: 1, output_tokens: 50, input_tokens: 9000, cache_read_tokens: 0, cache_create_tokens: 0 }),
      makeTurnMetric({ turnIndex: 2, output_tokens: 50, input_tokens: 9000, cache_read_tokens: 0, cache_create_tokens: 0 }),
    ];
    const ctx = buildContext(baseScan, baseUsage, metrics);

    // Last 3 output = 100+50+50 = 200
    // Last 3 total = (100+9000) + (50+9000) + (50+9000) = 27200
    expect(ctx.derived.last3OutputRatio).toBeCloseTo(200 / 27200);
  });

  it('computes median and average turn cost', () => {
    const metrics = [
      makeTurnMetric({ turnIndex: 0, cost_usd: 0.01 }),
      makeTurnMetric({ turnIndex: 1, cost_usd: 0.05 }),
      makeTurnMetric({ turnIndex: 2, cost_usd: 0.03 }),
    ];
    const ctx = buildContext(baseScan, baseUsage, metrics);

    expect(ctx.derived.avgTurnCostUsd).toBeCloseTo(0.03);
    expect(ctx.derived.medianTurnCostUsd).toBe(0.03); // sorted: [0.01, 0.03, 0.05] → median = 0.03
  });

  it('detects compactions (context drop > 20%)', () => {
    const metrics = [
      makeTurnMetric({ turnIndex: 0, total_context_tokens: 100_000 }),
      makeTurnMetric({ turnIndex: 1, total_context_tokens: 150_000 }),
      makeTurnMetric({ turnIndex: 2, total_context_tokens: 80_000 }),  // drop > 20% from 150k
      makeTurnMetric({ turnIndex: 3, total_context_tokens: 120_000 }),
    ];
    const ctx = buildContext(baseScan, baseUsage, metrics);

    expect(ctx.sessionCompactions).toBe(1);
  });

  it('builds evidence summary from injected files', () => {
    const evidenceReport: EvidenceReport = {
      request_id: 'req-1',
      timestamp: '2026-03-29T12:00:00Z',
      engine_version: '1.0',
      fusion_method: 'weighted',
      files: [
        { filePath: '/a.ts', category: 'project', signals: [], rawScore: 0.9, normalizedScore: 0.9, classification: 'confirmed' },
        { filePath: '/b.md', category: 'memory', signals: [], rawScore: 0.2, normalizedScore: 0.2, classification: 'unverified' },
      ],
      thresholds: { confirmed_min: 0.7, likely_min: 0.4 },
    };
    const scanWithFiles: PromptScan = {
      ...baseScan,
      injected_files: [
        { path: '/a.ts', category: 'project', estimated_tokens: 500 },
        { path: '/b.md', category: 'memory', estimated_tokens: 300 },
      ] as PromptScan['injected_files'],
      evidence_report: evidenceReport,
    };
    const ctx = buildContext(scanWithFiles, baseUsage, [makeTurnMetric({ turnIndex: 0 })]);

    expect(ctx.derived.evidenceSummary.confirmed).toBe(1);
    expect(ctx.derived.evidenceSummary.unverified).toBe(1);
    expect(ctx.derived.evidenceSummary.lowValueCandidates).toHaveLength(1);
    expect(ctx.derived.evidenceSummary.lowValueCandidates[0].path).toBe('/b.md');
  });

  it('accepts optional mcpAnalysis', () => {
    const mcp: SessionMcpAnalysis = {
      totalToolCalls: 20,
      mcpCalls: 15,
      toolResultTokens: 5000,
      toolBreakdown: { 'mcp:read': 10, 'mcp:write': 5 },
      redundantPatterns: [{ toolName: 'mcp:read', count: 5, description: 'repeated reads' }],
    };
    const ctx = buildContext(baseScan, baseUsage, [makeTurnMetric({ turnIndex: 0 })], mcp);

    expect(ctx.mcpAnalysis).toBe(mcp);
  });
});

// ---------------------------------------------------------------------------
// engine.ts — evaluate()
// ---------------------------------------------------------------------------

describe('evaluate', () => {
  const makeContext = (overrides?: Partial<GuardrailContext>): GuardrailContext => {
    const metrics = [
      makeTurnMetric({ turnIndex: 0 }),
      makeTurnMetric({ turnIndex: 1 }),
      makeTurnMetric({ turnIndex: 2 }),
    ];
    const base = buildContext(baseScan, baseUsage, metrics, emptyMcp);
    return { ...base, ...overrides };
  };

  it('returns healthy assessment with empty rules', () => {
    const ctx = makeContext();
    const result = evaluate(ctx, []);

    expect(result.primary).toBeNull();
    expect(result.secondary).toEqual([]);
    expect(result.all).toEqual([]);
    expect(result.summary.sessionHealth).toBe('healthy');
    expect(result.summary.topRiskIds).toEqual([]);
    expect(result.generatedAt).toBeTruthy();
  });

  it('returns healthy assessment when no rule fires', () => {
    const noopRule: GuardrailRule = {
      id: 'noop',
      evaluate: () => null,
    };
    const ctx = makeContext();
    const result = evaluate(ctx, [noopRule]);

    expect(result.primary).toBeNull();
    expect(result.summary.sessionHealth).toBe('healthy');
  });

  it('selects single recommendation as primary', () => {
    const rule: GuardrailRule = {
      id: 'test-rule',
      evaluate: () => ({
        id: 'test-rule',
        severity: 'warning',
        title: 'Test Warning',
        reason: 'Test reason',
        action: 'Test action',
        confidence: 0.8,
        evidence: ['signal-1'],
      }),
    };
    const ctx = makeContext();
    const result = evaluate(ctx, [rule]);

    expect(result.primary).not.toBeNull();
    expect(result.primary!.id).toBe('test-rule');
    expect(result.secondary).toEqual([]);
    expect(result.all).toHaveLength(1);
    expect(result.summary.sessionHealth).toBe('watch');
  });

  it('ranks critical above warning', () => {
    const warningRule: GuardrailRule = {
      id: 'warn',
      evaluate: () => ({
        id: 'warn',
        severity: 'warning',
        title: 'Warning',
        reason: 'w',
        action: 'w',
        confidence: 0.9,
        evidence: [],
      }),
    };
    const criticalRule: GuardrailRule = {
      id: 'crit',
      evaluate: () => ({
        id: 'crit',
        severity: 'critical',
        title: 'Critical',
        reason: 'c',
        action: 'c',
        confidence: 0.7,
        evidence: [],
      }),
    };
    const ctx = makeContext();
    const result = evaluate(ctx, [warningRule, criticalRule]);

    expect(result.primary!.id).toBe('crit');
    expect(result.secondary).toHaveLength(1);
    expect(result.secondary[0].id).toBe('warn');
    expect(result.summary.sessionHealth).toBe('risky');
  });

  it('ranks higher confidence first within same severity', () => {
    const lowConf: GuardrailRule = {
      id: 'low',
      evaluate: () => ({
        id: 'low',
        severity: 'warning',
        title: 'Low',
        reason: 'l',
        action: 'l',
        confidence: 0.6,
        evidence: [],
      }),
    };
    const highConf: GuardrailRule = {
      id: 'high',
      evaluate: () => ({
        id: 'high',
        severity: 'warning',
        title: 'High',
        reason: 'h',
        action: 'h',
        confidence: 0.9,
        evidence: [],
      }),
    };
    const ctx = makeContext();
    const result = evaluate(ctx, [lowConf, highConf]);

    expect(result.primary!.id).toBe('high');
  });

  it('limits secondary to max 2 recommendations', () => {
    const makeRule = (id: string, conf: number): GuardrailRule => ({
      id,
      evaluate: () => ({
        id,
        severity: 'warning' as const,
        title: id,
        reason: id,
        action: id,
        confidence: conf,
        evidence: [],
      }),
    });

    const ctx = makeContext();
    const result = evaluate(ctx, [
      makeRule('a', 0.9),
      makeRule('b', 0.8),
      makeRule('c', 0.7),
      makeRule('d', 0.6),
    ]);

    expect(result.primary!.id).toBe('a');
    expect(result.secondary).toHaveLength(2);
    expect(result.all).toHaveLength(4);
  });

  it('determines sessionHealth from highest severity', () => {
    const infoRule: GuardrailRule = {
      id: 'info',
      evaluate: () => ({
        id: 'info',
        severity: 'info',
        title: 'Info',
        reason: 'i',
        action: 'i',
        confidence: 0.7,
        evidence: [],
      }),
    };
    const ctx = makeContext();

    const infoResult = evaluate(ctx, [infoRule]);
    expect(infoResult.summary.sessionHealth).toBe('watch');
  });

  it('sets topRiskIds from all fired rules', () => {
    const makeRule = (id: string): GuardrailRule => ({
      id,
      evaluate: () => ({
        id,
        severity: 'warning' as const,
        title: id,
        reason: id,
        action: id,
        confidence: 0.7,
        evidence: [],
      }),
    });
    const ctx = makeContext();
    const result = evaluate(ctx, [makeRule('a'), makeRule('b')]);

    expect(result.summary.topRiskIds).toContain('a');
    expect(result.summary.topRiskIds).toContain('b');
  });
});

// ---------------------------------------------------------------------------
// MVP Rules — individual rule tests
// ---------------------------------------------------------------------------

describe('compactNow rule', () => {
  it('does not fire on healthy session', () => {
    const metrics = [
      makeTurnMetric({ turnIndex: 0, total_context_tokens: 10_000 }),
      makeTurnMetric({ turnIndex: 1, total_context_tokens: 15_000 }),
    ];
    const ctx = buildContext(baseScan, baseUsage, metrics);
    expect(compactNowRule.evaluate(ctx)).toBeNull();
  });

  it('fires warning when context >= 80%', () => {
    const metrics = [
      makeTurnMetric({ turnIndex: 0, total_context_tokens: 150_000 }),
      makeTurnMetric({ turnIndex: 1, total_context_tokens: 165_000 }), // 82.5% of 200K
    ];
    const ctx = buildContext(baseScan, baseUsage, metrics);
    const rec = compactNowRule.evaluate(ctx);

    expect(rec).not.toBeNull();
    expect(rec!.id).toBe('compact-now');
    expect(rec!.severity).toBe('warning');
    expect(rec!.confidence).toBeGreaterThanOrEqual(0.60);
  });

  it('fires critical when context >= 90%', () => {
    const metrics = [
      makeTurnMetric({ turnIndex: 0, total_context_tokens: 170_000 }),
      makeTurnMetric({ turnIndex: 1, total_context_tokens: 185_000 }), // 92.5% of 200K
    ];
    const ctx = buildContext(baseScan, baseUsage, metrics);
    const rec = compactNowRule.evaluate(ctx);

    expect(rec).not.toBeNull();
    expect(rec!.severity).toBe('critical');
    expect(rec!.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it('increases confidence with steep growth', () => {
    // Growth = 20K / 200K = 10% > STEEP_GROWTH_PCT (8%)
    const metrics = [
      makeTurnMetric({ turnIndex: 0, total_context_tokens: 140_000 }),
      makeTurnMetric({ turnIndex: 1, total_context_tokens: 160_000 }), // 80%
    ];
    const ctx = buildContext(baseScan, baseUsage, metrics);
    const rec = compactNowRule.evaluate(ctx);

    expect(rec).not.toBeNull();
    // Base 0.60 + steep growth 0.10 = 0.70
    expect(rec!.confidence).toBeGreaterThanOrEqual(0.70);
  });

  it('fires on projected next turn crossing 90%', () => {
    // Current: 75%, growth: 16% → projected: 91%
    const metrics = [
      makeTurnMetric({ turnIndex: 0, total_context_tokens: 118_000 }),
      makeTurnMetric({ turnIndex: 1, total_context_tokens: 150_000 }), // 75%, growth=16%
    ];
    const ctx = buildContext(baseScan, baseUsage, metrics);
    const rec = compactNowRule.evaluate(ctx);

    expect(rec).not.toBeNull();
  });

  it('returns null with empty turnMetrics', () => {
    const ctx = buildContext(baseScan, baseUsage, []);
    expect(compactNowRule.evaluate(ctx)).toBeNull();
  });
});

describe('toolLoop rule', () => {
  it('does not fire without redundant patterns or dominant tools', () => {
    const ctx = buildContext(baseScan, baseUsage, [makeTurnMetric({ turnIndex: 0 })], emptyMcp);
    expect(toolLoopRule.evaluate(ctx)).toBeNull();
  });

  it('fires when redundant patterns exist', () => {
    const mcp: SessionMcpAnalysis = {
      totalToolCalls: 20,
      mcpCalls: 15,
      toolResultTokens: 5000,
      toolBreakdown: {},
      redundantPatterns: [
        { toolName: 'mcp:read', count: 5, description: 'repeated reads' },
      ],
    };
    const ctx = buildContext(baseScan, baseUsage, [makeTurnMetric({ turnIndex: 0 })], mcp);
    const rec = toolLoopRule.evaluate(ctx);

    expect(rec).not.toBeNull();
    expect(rec!.id).toBe('tool-loop');
    expect(rec!.confidence).toBeGreaterThanOrEqual(0.70);
  });

  it('higher confidence with 3+ redundant patterns', () => {
    const mcp: SessionMcpAnalysis = {
      totalToolCalls: 30,
      mcpCalls: 25,
      toolResultTokens: 8000,
      toolBreakdown: {},
      redundantPatterns: [
        { toolName: 'mcp:read', count: 5, description: 'a' },
        { toolName: 'mcp:write', count: 3, description: 'b' },
        { toolName: 'mcp:search', count: 4, description: 'c' },
      ],
    };
    const ctx = buildContext(baseScan, baseUsage, [makeTurnMetric({ turnIndex: 0 })], mcp);
    const rec = toolLoopRule.evaluate(ctx);

    expect(rec).not.toBeNull();
    expect(rec!.confidence).toBeGreaterThanOrEqual(0.80);
    expect(rec!.severity).toBe('warning');
  });

  it('fires on dominant tool with flat output', () => {
    const scan: PromptScan = {
      ...baseScan,
      tool_summary: { Read: 8, Edit: 1, Bash: 1 },
    };
    const metrics = [
      makeTurnMetric({ turnIndex: 0, output_tokens: 50 }), // flat output
    ];
    const ctx = buildContext(scan, baseUsage, metrics, emptyMcp);
    const rec = toolLoopRule.evaluate(ctx);

    expect(rec).not.toBeNull();
  });
});

describe('splitSession rule', () => {
  it('does not fire on short session', () => {
    const metrics = Array.from({ length: 5 }, (_, i) =>
      makeTurnMetric({ turnIndex: i, cache_read_tokens: 8000, input_tokens: 1000, output_tokens: 500, cache_create_tokens: 500 }),
    );
    const ctx = buildContext(baseScan, baseUsage, metrics);
    expect(splitSessionRule.evaluate(ctx)).toBeNull();
  });

  it('fires when >= 12 turns and cache read >= 70%', () => {
    const metrics = Array.from({ length: 14 }, (_, i) =>
      makeTurnMetric({ turnIndex: i, cache_read_tokens: 8000, input_tokens: 1000, output_tokens: 500, cache_create_tokens: 500 }),
    );
    const ctx = buildContext(baseScan, baseUsage, metrics);
    const rec = splitSessionRule.evaluate(ctx);

    expect(rec).not.toBeNull();
    expect(rec!.id).toBe('split-session');
  });

  it('fires when >= 20 turns regardless of cache ratio', () => {
    const metrics = Array.from({ length: 22 }, (_, i) =>
      makeTurnMetric({ turnIndex: i, cache_read_tokens: 100, input_tokens: 5000, output_tokens: 3000, cache_create_tokens: 100 }),
    );
    const ctx = buildContext(baseScan, baseUsage, metrics);
    const rec = splitSessionRule.evaluate(ctx);

    expect(rec).not.toBeNull();
    expect(rec!.severity).toBe('warning');
    expect(rec!.confidence).toBeGreaterThanOrEqual(0.80);
  });
});

describe('cacheExplosion rule', () => {
  it('does not fire below 85% cache read', () => {
    const metrics = [
      makeTurnMetric({ turnIndex: 0, cache_read_tokens: 7000, input_tokens: 2000, output_tokens: 1000, cache_create_tokens: 500 }),
    ];
    const ctx = buildContext(baseScan, baseUsage, metrics);
    // 7000 / (7000+2000+1000+500) = 66.7% < 85%
    expect(cacheExplosionRule.evaluate(ctx)).toBeNull();
  });

  it('fires warning at >= 85% cache read', () => {
    const metrics = [
      makeTurnMetric({ turnIndex: 0, cache_read_tokens: 9000, input_tokens: 500, output_tokens: 200, cache_create_tokens: 100 }),
    ];
    const ctx = buildContext(baseScan, baseUsage, metrics);
    // 9000 / (9000+500+200+100) = 91.8% > 85%
    const rec = cacheExplosionRule.evaluate(ctx);

    expect(rec).not.toBeNull();
    expect(rec!.id).toBe('cache-explosion');
    expect(rec!.severity).toBe('warning');
  });

  it('fires critical at >= 95% cache read', () => {
    const metrics = [
      makeTurnMetric({ turnIndex: 0, cache_read_tokens: 9700, input_tokens: 100, output_tokens: 100, cache_create_tokens: 50 }),
    ];
    const ctx = buildContext(baseScan, baseUsage, metrics);
    // 9700 / (9700+100+100+50) = 97.5% > 95%
    const rec = cacheExplosionRule.evaluate(ctx);

    expect(rec).not.toBeNull();
    expect(rec!.severity).toBe('critical');
    expect(rec!.confidence).toBeGreaterThanOrEqual(0.90);
  });
});

describe('lowValueInjectedFiles rule', () => {
  it('does not fire without low-value candidates', () => {
    const ctx = buildContext(baseScan, baseUsage, [makeTurnMetric({ turnIndex: 0 })]);
    expect(lowValueInjectedFilesRule.evaluate(ctx)).toBeNull();
  });

  it('does not fire when candidate share < 20%', () => {
    const evidenceReport: EvidenceReport = {
      request_id: 'req-1',
      timestamp: '2026-03-29T12:00:00Z',
      engine_version: '1.0',
      fusion_method: 'weighted',
      files: [
        { filePath: '/big.ts', category: 'project', signals: [], rawScore: 0.9, normalizedScore: 0.9, classification: 'confirmed' },
        { filePath: '/small.md', category: 'memory', signals: [], rawScore: 0.2, normalizedScore: 0.2, classification: 'unverified' },
      ],
      thresholds: { confirmed_min: 0.7, likely_min: 0.4 },
    };
    const scan: PromptScan = {
      ...baseScan,
      injected_files: [
        { path: '/big.ts', category: 'project', estimated_tokens: 5000 },
        { path: '/small.md', category: 'memory', estimated_tokens: 100 },
      ] as PromptScan['injected_files'],
      total_injected_tokens: 5100,
      evidence_report: evidenceReport,
    };
    const ctx = buildContext(scan, baseUsage, [makeTurnMetric({ turnIndex: 0 })]);
    // 100 / 5100 = 1.96% < 20%
    expect(lowValueInjectedFilesRule.evaluate(ctx)).toBeNull();
  });

  it('fires when candidate share >= 20%', () => {
    const evidenceReport: EvidenceReport = {
      request_id: 'req-1',
      timestamp: '2026-03-29T12:00:00Z',
      engine_version: '1.0',
      fusion_method: 'weighted',
      files: [
        { filePath: '/a.ts', category: 'project', signals: [], rawScore: 0.9, normalizedScore: 0.9, classification: 'confirmed' },
        { filePath: '/b.md', category: 'memory', signals: [], rawScore: 0.2, normalizedScore: 0.2, classification: 'unverified' },
        { filePath: '/c.md', category: 'rules', signals: [], rawScore: 0.3, normalizedScore: 0.3, classification: 'likely' },
      ],
      thresholds: { confirmed_min: 0.7, likely_min: 0.4 },
    };
    const scan: PromptScan = {
      ...baseScan,
      injected_files: [
        { path: '/a.ts', category: 'project', estimated_tokens: 3000 },
        { path: '/b.md', category: 'memory', estimated_tokens: 1200 },
        { path: '/c.md', category: 'rules', estimated_tokens: 800 },
      ] as PromptScan['injected_files'],
      total_injected_tokens: 5000,
      evidence_report: evidenceReport,
    };
    const ctx = buildContext(scan, baseUsage, [makeTurnMetric({ turnIndex: 0 })]);
    // Candidates: /b.md (1200) + /c.md (800) = 2000 / 5000 = 40% >= 20%
    const rec = lowValueInjectedFilesRule.evaluate(ctx);

    expect(rec).not.toBeNull();
    expect(rec!.id).toBe('low-value-injected-files');
    expect(rec!.estimatedSavings).toBeDefined();
    expect(rec!.estimatedSavings!.tokens).toBe(2000);
  });

  it('includes unverified bonus in confidence', () => {
    const evidenceReport: EvidenceReport = {
      request_id: 'req-1',
      timestamp: '2026-03-29T12:00:00Z',
      engine_version: '1.0',
      fusion_method: 'weighted',
      files: [
        { filePath: '/x.ts', category: 'project', signals: [], rawScore: 0.1, normalizedScore: 0.1, classification: 'unverified' },
      ],
      thresholds: { confirmed_min: 0.7, likely_min: 0.4 },
    };
    const scan: PromptScan = {
      ...baseScan,
      injected_files: [
        { path: '/x.ts', category: 'project', estimated_tokens: 3000 },
      ] as PromptScan['injected_files'],
      total_injected_tokens: 3000,
      evidence_report: evidenceReport,
    };
    const ctx = buildContext(scan, baseUsage, [makeTurnMetric({ turnIndex: 0 })]);
    const rec = lowValueInjectedFilesRule.evaluate(ctx);

    expect(rec).not.toBeNull();
    // Base 0.65 + unverified 0.10 + share>=0.40 (100%) 0.10 = 0.85
    expect(rec!.confidence).toBeGreaterThanOrEqual(0.85);
  });
});

// ---------------------------------------------------------------------------
// Integration: MVP_RULES with evaluate
// ---------------------------------------------------------------------------

describe('MVP rules integration', () => {
  it('returns healthy for a clean short session', () => {
    const metrics = [
      makeTurnMetric({ turnIndex: 0, total_context_tokens: 10_000, cache_read_tokens: 1000, input_tokens: 3000, output_tokens: 2000, cache_create_tokens: 500 }),
      makeTurnMetric({ turnIndex: 1, total_context_tokens: 15_000, cache_read_tokens: 2000, input_tokens: 3000, output_tokens: 2500, cache_create_tokens: 500 }),
    ];
    const ctx = buildContext(baseScan, baseUsage, metrics, emptyMcp);
    const result = evaluate(ctx, MVP_RULES);

    expect(result.summary.sessionHealth).toBe('healthy');
    expect(result.primary).toBeNull();
  });

  it('detects multiple issues and ranks correctly', () => {
    // High context (92%) + long session (15 turns) + high cache (90%+)
    const metrics = Array.from({ length: 15 }, (_, i) =>
      makeTurnMetric({
        turnIndex: i,
        total_context_tokens: 180_000 + i * 500,
        cache_read_tokens: 9500,
        input_tokens: 200,
        output_tokens: 100,
        cache_create_tokens: 100,
      }),
    );
    const ctx = buildContext(baseScan, baseUsage, metrics, emptyMcp);
    const result = evaluate(ctx, MVP_RULES);

    // Should fire multiple rules
    expect(result.all.length).toBeGreaterThan(1);
    // Primary should be the highest severity+confidence (compact-now or cache-explosion)
    expect(['compact-now', 'cache-explosion']).toContain(result.primary!.id);
    expect(result.summary.sessionHealth).not.toBe('healthy');
  });

  it('handles missing data gracefully (null usage, empty metrics)', () => {
    const ctx = buildContext(baseScan, null, [], emptyMcp);
    const result = evaluate(ctx, MVP_RULES);

    // No rule should crash
    expect(result.summary.sessionHealth).toBe('healthy');
  });
});
