import { describe, it, expect } from 'vitest';
import type { GuardrailAssessment, GuardrailRecommendation } from '../../../../guardrails/types';
import {
  shouldShowGuardrailSummary,
  getHealthStyle,
  formatEvidenceBullets,
  getLowValueFileSummary,
} from '../guardrailSummaryHelpers';

// ── Fixtures ──

const makeRec = (
  overrides: Partial<GuardrailRecommendation> = {},
): GuardrailRecommendation => ({
  id: 'test-rule',
  severity: 'warning',
  title: 'Test Warning',
  reason: 'Test reason',
  action: 'Take action',
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

// ── shouldShowGuardrailSummary ──

describe('shouldShowGuardrailSummary', () => {
  it('returns false when assessment is undefined', () => {
    expect(shouldShowGuardrailSummary(undefined)).toBe(false);
  });

  it('returns false when healthy with no recommendations', () => {
    const assessment = makeAssessment();
    expect(shouldShowGuardrailSummary(assessment)).toBe(false);
  });

  it('returns true when primary recommendation exists', () => {
    const primary = makeRec({ severity: 'critical' });
    const assessment = makeAssessment({ primary, all: [primary] });
    expect(shouldShowGuardrailSummary(assessment)).toBe(true);
  });

  it('returns true when session health is not healthy', () => {
    const assessment = makeAssessment({
      summary: { sessionHealth: 'watch', topRiskIds: ['tool-loop'] },
    });
    expect(shouldShowGuardrailSummary(assessment)).toBe(true);
  });
});

// ── getHealthStyle ──

describe('getHealthStyle', () => {
  it('returns green for healthy', () => {
    const style = getHealthStyle('healthy');
    expect(style.color).toBe('#30D158');
    expect(style.label).toBe('Healthy');
  });

  it('returns orange for watch', () => {
    const style = getHealthStyle('watch');
    expect(style.color).toBe('#FF9500');
    expect(style.label).toBe('Watch');
  });

  it('returns red for risky', () => {
    const style = getHealthStyle('risky');
    expect(style.color).toBe('#FF3B30');
    expect(style.label).toBe('Risky');
  });
});

// ── formatEvidenceBullets ──

describe('formatEvidenceBullets', () => {
  it('returns empty array for no evidence', () => {
    expect(formatEvidenceBullets([])).toEqual([]);
  });

  it('returns all evidence items', () => {
    const evidence = ['Context at 92%', 'Cost spike detected'];
    expect(formatEvidenceBullets(evidence)).toEqual(evidence);
  });

  it('caps at 5 bullets', () => {
    const evidence = Array.from({ length: 10 }, (_, i) => `Evidence ${i}`);
    expect(formatEvidenceBullets(evidence)).toHaveLength(5);
  });
});

// ── getLowValueFileSummary ──

describe('getLowValueFileSummary', () => {
  it('returns empty when no assessment', () => {
    expect(getLowValueFileSummary(undefined)).toEqual([]);
  });

  it('returns empty when no low-value-injected-files recommendation', () => {
    const primary = makeRec({ id: 'compact-now' });
    const assessment = makeAssessment({ primary, all: [primary] });
    expect(getLowValueFileSummary(assessment)).toEqual([]);
  });

  it('extracts low-value file info from estimatedSavings', () => {
    const rec = makeRec({
      id: 'low-value-injected-files',
      estimatedSavings: {
        tokens: 15000,
        note: 'Remove 3 unverified files',
      },
    });
    const assessment = makeAssessment({ primary: rec, all: [rec] });
    const result = getLowValueFileSummary(assessment);
    expect(result).toHaveLength(1);
    expect(result[0].tokens).toBe(15000);
    expect(result[0].note).toBe('Remove 3 unverified files');
  });
});
