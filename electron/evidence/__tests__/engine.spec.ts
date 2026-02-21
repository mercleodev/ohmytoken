/**
 * Integration tests for EvidenceEngine
 */

import { describe, it, expect } from 'vitest';
import { EvidenceEngine } from '../engine';
import { DEFAULT_ENGINE_CONFIG, mergeConfig, validateConfig } from '../config';

const makeScan = () => ({
  request_id: 'req-test-001',
  session_id: 'sess-test-001',
  user_prompt: 'Help me implement the evidence scoring engine',
  assistant_response: 'I will implement the evidence scoring engine following the CLAUDE.md instructions and commit checklist.',
  injected_files: [
    { path: 'CLAUDE.md', category: 'global', estimated_tokens: 800 },
    { path: 'project/CLAUDE.md', category: 'project', estimated_tokens: 400 },
    { path: 'project/.claude/rules/commit-checklist.md', category: 'rules', estimated_tokens: 200 },
    { path: 'memory/MEMORY.md', category: 'memory', estimated_tokens: 150 },
  ],
  total_injected_tokens: 1550,
  tool_calls: [
    { index: 0, name: 'Read', input_summary: 'CLAUDE.md' },
    { index: 1, name: 'Write', input_summary: '/project/electron/evidence/engine.ts' },
    { index: 2, name: 'Grep', input_summary: 'evidence scoring in /project/src/' },
  ],
  context_estimate: {
    system_tokens: 8000,
    total_tokens: 50000,
  },
});

describe('EvidenceEngine', () => {
  it('produces a valid EvidenceReport', () => {
    const engine = new EvidenceEngine();
    const scan = makeScan();
    const report = engine.score(scan);

    expect(report.request_id).toBe('req-test-001');
    expect(report.engine_version).toBe('1.0.0');
    expect(report.fusion_method).toBe('weighted_sum');
    expect(report.files).toHaveLength(4);
    expect(report.thresholds.confirmed_min).toBe(0.7);
    expect(report.thresholds.likely_min).toBe(0.4);
  });

  it('classifies files into C/L/U based on thresholds', () => {
    // With lower thresholds, tool-referenced files should score as confirmed/likely
    const engine = new EvidenceEngine({
      thresholds: { confirmed_min: 0.25, likely_min: 0.15 },
    });
    const scan = makeScan();
    const report = engine.score(scan);

    const classifications = report.files.map((f) => f.classification);
    // CLAUDE.md with direct Read reference should now classify as confirmed
    expect(classifications).toContain('confirmed');
  });

  it('CLAUDE.md with direct Read reference scores higher than unreferenced files', () => {
    const engine = new EvidenceEngine();
    const scan = makeScan();
    const report = engine.score(scan);

    const globalFile = report.files.find(
      (f) => f.filePath === 'CLAUDE.md',
    );
    expect(globalFile).toBeDefined();
    // Tool reference (15/15) + category prior + position primacy = notable score
    expect(globalFile!.normalizedScore).toBeGreaterThan(0.2);
    // Should be the highest scored file (has direct Read reference)
    const maxScore = Math.max(...report.files.map((f) => f.normalizedScore));
    expect(globalFile!.normalizedScore).toBe(maxScore);
  });

  it('file without tool reference gets lower score', () => {
    const engine = new EvidenceEngine();
    const scan = makeScan();
    const report = engine.score(scan);

    const memoryFile = report.files.find((f) => f.filePath.includes('MEMORY.md'));
    const globalFile = report.files.find(
      (f) => f.filePath === 'CLAUDE.md',
    );
    expect(memoryFile).toBeDefined();
    expect(globalFile).toBeDefined();
    expect(memoryFile!.normalizedScore).toBeLessThan(globalFile!.normalizedScore);
  });

  it('each file has signals from all enabled plugins', () => {
    const engine = new EvidenceEngine();
    const report = engine.score(makeScan());
    const enabledCount = Object.values(DEFAULT_ENGINE_CONFIG.signals).filter(
      (s) => s.enabled,
    ).length;

    for (const f of report.files) {
      expect(f.signals.length).toBe(enabledCount);
    }
  });

  it('respects disabled signal', () => {
    const engine = new EvidenceEngine({
      signals: {
        'category-prior': { signalId: 'category-prior', enabled: false, weight: 1, params: {} },
      },
    });
    const report = engine.score(makeScan());
    for (const f of report.files) {
      const cpSignal = f.signals.find((s) => s.signalId === 'category-prior');
      expect(cpSignal).toBeUndefined();
    }
  });

  it('uses Dempster-Shafer fusion when configured', () => {
    const engine = new EvidenceEngine({ fusion_method: 'dempster_shafer' });
    const report = engine.score(makeScan());
    expect(report.fusion_method).toBe('dempster_shafer');
    // Should still produce valid scores
    for (const f of report.files) {
      expect(f.normalizedScore).toBeGreaterThanOrEqual(0);
      expect(f.normalizedScore).toBeLessThanOrEqual(1);
    }
  });

  it('accepts file contents for text overlap', () => {
    const engine = new EvidenceEngine();
    const scan = makeScan();
    const report = engine.score(scan, {
      fileContents: {
        'CLAUDE.md': 'Always respond in Korean. Use evidence scoring engine.',
      },
    });
    const globalFile = report.files.find(
      (f) => f.filePath === 'CLAUDE.md',
    );
    const textOverlap = globalFile?.signals.find((s) => s.signalId === 'text-overlap');
    // With file content available, text overlap should produce some score
    expect(textOverlap).toBeDefined();
  });

  it('accepts previous scores for session history', () => {
    const engine = new EvidenceEngine();
    const report = engine.score(makeScan(), {
      previousScores: {
        'CLAUDE.md': [0.8, 0.7],
      },
    });
    const globalFile = report.files.find(
      (f) => f.filePath === 'CLAUDE.md',
    );
    const historySignal = globalFile?.signals.find(
      (s) => s.signalId === 'session-history',
    );
    expect(historySignal).toBeDefined();
    expect(historySignal!.score).toBeGreaterThan(0);
  });
});

describe('Config', () => {
  it('DEFAULT_ENGINE_CONFIG is valid', () => {
    const result = validateConfig(DEFAULT_ENGINE_CONFIG);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('mergeConfig preserves defaults for missing fields', () => {
    const merged = mergeConfig({ fusion_method: 'dempster_shafer' });
    expect(merged.fusion_method).toBe('dempster_shafer');
    expect(merged.thresholds.confirmed_min).toBe(0.7);
    expect(Object.keys(merged.signals)).toHaveLength(
      Object.keys(DEFAULT_ENGINE_CONFIG.signals).length,
    );
  });

  it('mergeConfig overrides signal params', () => {
    const merged = mergeConfig({
      signals: {
        'category-prior': {
          signalId: 'category-prior',
          enabled: true,
          weight: 0.5,
          params: { prior_global: 50 },
        },
      },
    });
    expect(merged.signals['category-prior'].weight).toBe(0.5);
    expect(merged.signals['category-prior'].params.prior_global).toBe(50);
    // Unset params preserved from default
    expect(merged.signals['category-prior'].params.prior_project).toBe(25);
  });

  it('validateConfig detects invalid thresholds', () => {
    const bad = mergeConfig({
      thresholds: { confirmed_min: 0.3, likely_min: 0.5 },
    });
    const result = validateConfig(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
