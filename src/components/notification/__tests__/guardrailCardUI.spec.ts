import { describe, it, expect } from 'vitest';
import type { GuardrailAssessment, GuardrailRecommendation } from '../../../guardrails/types';
import {
  getSeverityColor,
  getSeverityIcon,
  formatSavings,
  getVisibleRecommendations,
  getHealthLabel,
} from '../guardrailCardHelpers';

// ── Fixtures ──

const makeRec = (
  overrides: Partial<GuardrailRecommendation> = {},
): GuardrailRecommendation => ({
  id: 'test-rule',
  severity: 'warning',
  title: 'Test Warning',
  reason: 'Test reason for the warning',
  action: 'Take some action',
  confidence: 0.8,
  evidence: ['evidence-1'],
  ...overrides,
});

const makeAssessment = (
  overrides: Partial<GuardrailAssessment> = {},
): GuardrailAssessment => ({
  generatedAt: new Date().toISOString(),
  primary: null,
  secondary: [],
  all: [],
  summary: { sessionHealth: 'healthy', topRiskIds: [] },
  ...overrides,
});

// ── getSeverityColor ──

describe('getSeverityColor', () => {
  it('returns blue for info', () => {
    expect(getSeverityColor('info')).toBe('#007AFF');
  });

  it('returns orange for warning', () => {
    expect(getSeverityColor('warning')).toBe('#FF9500');
  });

  it('returns red for critical', () => {
    expect(getSeverityColor('critical')).toBe('#FF3B30');
  });
});

// ── getSeverityIcon ──

describe('getSeverityIcon', () => {
  it('returns distinct icons for each severity', () => {
    const info = getSeverityIcon('info');
    const warning = getSeverityIcon('warning');
    const critical = getSeverityIcon('critical');

    expect(info).toBeTruthy();
    expect(warning).toBeTruthy();
    expect(critical).toBeTruthy();
    // All three should be different
    expect(new Set([info, warning, critical]).size).toBe(3);
  });
});

// ── formatSavings ──

describe('formatSavings', () => {
  it('returns null when no estimatedSavings', () => {
    expect(formatSavings(undefined)).toBeNull();
  });

  it('formats token savings', () => {
    const result = formatSavings({
      tokens: 15000,
      note: 'Remove 3 unverified files',
    });
    expect(result).toContain('15.0K');
    expect(result).toContain('Remove 3 unverified files');
  });

  it('formats cost savings', () => {
    const result = formatSavings({
      costUsd: 0.042,
      note: 'Estimated per-turn savings',
    });
    expect(result).toContain('$0.042');
    expect(result).toContain('Estimated per-turn savings');
  });

  it('formats both token and cost savings', () => {
    const result = formatSavings({
      tokens: 50000,
      costUsd: 0.1,
      note: 'Combined savings',
    });
    expect(result).toContain('50.0K');
    expect(result).toContain('$0.100');
  });
});

// ── getVisibleRecommendations ──

describe('getVisibleRecommendations', () => {
  it('returns empty arrays when assessment is undefined', () => {
    const result = getVisibleRecommendations(undefined);
    expect(result.primary).toBeNull();
    expect(result.secondary).toEqual([]);
  });

  it('returns empty arrays when no recommendations', () => {
    const assessment = makeAssessment();
    const result = getVisibleRecommendations(assessment);
    expect(result.primary).toBeNull();
    expect(result.secondary).toEqual([]);
  });

  it('returns primary recommendation', () => {
    const primary = makeRec({ id: 'compact-now', severity: 'critical' });
    const assessment = makeAssessment({ primary, all: [primary] });
    const result = getVisibleRecommendations(assessment);
    expect(result.primary).toEqual(primary);
    expect(result.secondary).toEqual([]);
  });

  it('returns up to 2 secondary recommendations', () => {
    const primary = makeRec({ id: 'compact-now', severity: 'critical' });
    const sec1 = makeRec({ id: 'tool-loop', severity: 'warning' });
    const sec2 = makeRec({ id: 'split-session', severity: 'info' });
    const assessment = makeAssessment({
      primary,
      secondary: [sec1, sec2],
      all: [primary, sec1, sec2],
    });
    const result = getVisibleRecommendations(assessment);
    expect(result.primary).toEqual(primary);
    expect(result.secondary).toHaveLength(2);
  });

  it('caps secondary at 2 even if more exist', () => {
    const primary = makeRec({ id: 'compact-now', severity: 'critical' });
    const secondaries = Array.from({ length: 5 }, (_, i) =>
      makeRec({ id: `rule-${i}`, severity: 'info' }),
    );
    const assessment = makeAssessment({
      primary,
      secondary: secondaries,
      all: [primary, ...secondaries],
    });
    const result = getVisibleRecommendations(assessment);
    expect(result.secondary).toHaveLength(2);
  });
});

// ── getHealthLabel ──

describe('getHealthLabel', () => {
  it('returns Healthy for healthy session', () => {
    const assessment = makeAssessment({ summary: { sessionHealth: 'healthy', topRiskIds: [] } });
    expect(getHealthLabel(assessment)).toBe('Healthy');
  });

  it('returns Watch for watch session', () => {
    const assessment = makeAssessment({ summary: { sessionHealth: 'watch', topRiskIds: ['tool-loop'] } });
    expect(getHealthLabel(assessment)).toBe('Watch');
  });

  it('returns Risky for risky session', () => {
    const assessment = makeAssessment({ summary: { sessionHealth: 'risky', topRiskIds: ['compact-now'] } });
    expect(getHealthLabel(assessment)).toBe('Risky');
  });

  it('returns null when no assessment', () => {
    expect(getHealthLabel(undefined)).toBeNull();
  });
});
