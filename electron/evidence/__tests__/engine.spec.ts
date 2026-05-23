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
    expect(report.thresholds.confirmed_min_raw).toBe(45);
    expect(report.thresholds.likely_min_raw).toBe(25);
  });

  it('classifies files into C/L/U based on thresholds', () => {
    // With lower thresholds, tool-referenced files should score as confirmed/likely
    const engine = new EvidenceEngine({
      thresholds: { confirmed_min_raw: 18, likely_min_raw: 10 },
    });
    const scan = makeScan();
    const report = engine.score(scan);

    const classifications = report.files.map((f) => f.classification);
    // CLAUDE.md with direct Read reference should now classify as confirmed
    expect(classifications).toContain('confirmed');
  });

  it('tool-referenced CLAUDE.md scores higher than unreferenced files', () => {
    const engine = new EvidenceEngine();
    const scan = makeScan();
    const report = engine.score(scan);

    // Both CLAUDE.md files match the "Read CLAUDE.md" tool call.
    // project/CLAUDE.md has a higher category-prior (project=50 vs global=25).
    const projectFile = report.files.find(
      (f) => f.filePath === 'project/CLAUDE.md',
    );
    const memoryFile = report.files.find(
      (f) => f.filePath.includes('MEMORY.md'),
    );
    expect(projectFile).toBeDefined();
    expect(memoryFile).toBeDefined();
    // Tool reference + higher prior → project CLAUDE.md notably higher than unreferenced memory
    expect(projectFile!.normalizedScore).toBeGreaterThan(0.2);
    expect(projectFile!.normalizedScore).toBeGreaterThan(memoryFile!.normalizedScore);
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

describe('EvidenceEngine — raw-score thresholds + ack protocol (#359)', () => {
  const rulesFile = (path: string, content: string) => ({
    path,
    category: 'rules' as const,
    estimated_tokens: Math.ceil(content.length / 4),
  });

  const TAILWIND_CONTENT = `<!-- canary:CANARY-tailwind -->
You must use the cnx helper from @utils/tailwind/cnx for class merging.`;
  const FSD_CONTENT = `<!-- canary:CANARY-fsd -->
You must respect the FSD layer boundaries.`;
  const NOISE_CONTENT = 'You must commit with WC-XXXXX format.';

  const baseScan = (assistantResponse: string) => ({
    request_id: 'req-359',
    session_id: 'sess-359',
    user_prompt: 'merge tailwind classes',
    assistant_response: assistantResponse,
    injected_files: [
      rulesFile('/project/.claude/rules/tailwind.md', TAILWIND_CONTENT),
      rulesFile('/project/.claude/rules/fsd.md', FSD_CONTENT),
      rulesFile('/project/.claude/rules/commit-pr.md', NOISE_CONTENT),
    ],
    total_injected_tokens: 600,
    tool_calls: [
      { index: 0, name: 'Read', input_summary: '/project/.claude/rules/tailwind.md' },
    ],
    context_estimate: { system_tokens: 1000, total_tokens: 2000 },
  });

  const fileContents = {
    '/project/.claude/rules/tailwind.md': TAILWIND_CONTENT,
    '/project/.claude/rules/fsd.md': FSD_CONTENT,
    '/project/.claude/rules/commit-pr.md': NOISE_CONTENT,
  };

  it('direct tool reference (Read on the exact file path) forces confirmed', () => {
    const engine = new EvidenceEngine();
    const scan = baseScan('I read tailwind.md and applied cnx.');
    const report = engine.score(scan, { fileContents });

    const tailwind = report.files.find((f) => f.filePath.endsWith('tailwind.md'));
    expect(tailwind).toBeDefined();
    expect(tailwind!.classification).toBe('confirmed');
  });

  it('USED ack token forces confirmed', () => {
    const engine = new EvidenceEngine();
    const scan = baseScan(
      'Applied cnx helper.\n[RULE-ACK:CANARY-tailwind=USED:applied cnx]',
    );
    const report = engine.score(scan, { fileContents });

    const tailwind = report.files.find((f) => f.filePath.endsWith('tailwind.md'));
    expect(tailwind).toBeDefined();
    expect(tailwind!.classification).toBe('confirmed');
  });

  it('NOT_APPLICABLE ack token caps classification at likely', () => {
    const engine = new EvidenceEngine();
    const scan = baseScan(
      '[RULE-ACK:CANARY-fsd=NOT_APPLICABLE:no FSD layer changes in this task]',
    );
    // Remove the Read tool call so fsd has no direct ref either
    scan.tool_calls = [];
    const report = engine.score(scan, { fileContents });

    const fsd = report.files.find((f) => f.filePath.endsWith('fsd.md'));
    expect(fsd).toBeDefined();
    expect(fsd!.classification).toBe('likely');
  });

  it('files with neither direct ref nor ack token follow raw-score thresholds', () => {
    const engine = new EvidenceEngine();
    const scan = baseScan('plain response with no ack tokens');
    scan.tool_calls = [];
    const report = engine.score(scan, { fileContents });

    for (const f of report.files) {
      expect(f.classification).toBe('unverified');
    }
  });

  it('matches ack canary id from <!-- canary:CANARY-... --> marker in file content', () => {
    const engine = new EvidenceEngine();
    const scan = baseScan(
      'work done.\n[RULE-ACK:CANARY-tailwind=USED:applied cnx]',
    );
    scan.tool_calls = [];
    const report = engine.score(scan, { fileContents });

    const tailwind = report.files.find((f) => f.filePath.endsWith('tailwind.md'));
    expect(tailwind!.classification).toBe('confirmed');

    // commit-pr.md has no canary marker and no matching ack — stays unverified
    const commit = report.files.find((f) => f.filePath.endsWith('commit-pr.md'));
    expect(commit!.classification).toBe('unverified');
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
    expect(merged.thresholds.confirmed_min_raw).toBe(45);
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
    expect(merged.signals['category-prior'].params.prior_project).toBe(50);
  });

  it('validateConfig detects invalid thresholds', () => {
    const bad = mergeConfig({
      thresholds: { confirmed_min_raw: 20, likely_min_raw: 30 },
    });
    const result = validateConfig(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
