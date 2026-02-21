/**
 * Unit tests for Evidence Scoring Engine — Signal Plugins
 */

import { describe, it, expect } from 'vitest';
import { categoryPriorSignal } from '../signals/categoryPrior';
import { tokenProportionSignal } from '../signals/tokenProportion';
import { positionEffectSignal } from '../signals/positionEffect';
import { toolReferenceSignal } from '../signals/toolReference';
import { textOverlapSignal } from '../signals/textOverlap';
import { instructionComplianceSignal } from '../signals/instructionCompliance';
import { sessionHistorySignal } from '../signals/sessionHistory';
import type { SignalInput } from '../types';

const makeInput = (overrides: Partial<SignalInput> = {}): SignalInput => ({
  file: {
    path: 'CLAUDE.md',
    category: 'global',
    estimated_tokens: 500,
    content: 'You must always respond in Korean.\nNever skip this checklist.',
    ...overrides.file,
  },
  scan: {
    request_id: 'req-001',
    session_id: 'sess-001',
    user_prompt: 'Help me fix this bug',
    assistant_response: 'I found the issue in CLAUDE.md and fixed it. Always responding in Korean as instructed.',
    injected_files: [
      { path: 'CLAUDE.md', category: 'global', estimated_tokens: 500 },
      { path: '/project/CLAUDE.md', category: 'project', estimated_tokens: 300 },
      { path: '/project/.claude/rules/commit.md', category: 'rules', estimated_tokens: 200 },
    ],
    total_injected_tokens: 1000,
    tool_calls: [
      { index: 0, name: 'Read', input_summary: 'CLAUDE.md' },
      { index: 1, name: 'Edit', input_summary: '/project/src/main.ts' },
    ],
    context_estimate: {
      system_tokens: 5000,
      total_tokens: 20000,
    },
    ...overrides.scan,
  },
  position: {
    index: 0,
    total: 3,
    ...overrides.position,
  },
  previousScores: overrides.previousScores,
});

const defaultParams = (signal: { paramDefs: Array<{ key: string; default: number | string | boolean }> }) => {
  const params: Record<string, number | string | boolean> = {};
  for (const p of signal.paramDefs) params[p.key] = p.default;
  return params;
};

// --- Signal 1: Category Prior ---
describe('categoryPriorSignal', () => {
  it('scores global category with default priors', () => {
    const input = makeInput();
    const result = categoryPriorSignal.compute(input, defaultParams(categoryPriorSignal));
    expect(result.signalId).toBe('category-prior');
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(30);
    // global prior = 25, sum = 105, score = 25/105 * 30 ≈ 7.14
    expect(result.score).toBeCloseTo(25 / 105 * 30, 1);
  });

  it('scores rules category higher relative weight', () => {
    const inputRules = makeInput({ file: { path: '/project/.claude/rules/test.md', category: 'rules', estimated_tokens: 100 } });
    const resultRules = categoryPriorSignal.compute(inputRules, defaultParams(categoryPriorSignal));
    // rules prior = 25 same as global
    expect(resultRules.score).toBeCloseTo(25 / 105 * 30, 1);
  });

  it('returns zero when all priors are zero', () => {
    const params = { prior_global: 0, prior_project: 0, prior_rules: 0, prior_memory: 0, prior_skill: 0, max_score: 30 };
    const result = categoryPriorSignal.compute(makeInput(), params);
    expect(result.score).toBe(0);
  });
});

// --- Signal 2: Text Overlap ---
describe('textOverlapSignal', () => {
  it('detects non-zero similarity between file and response', () => {
    const input = makeInput({
      file: {
        path: '/test.md',
        category: 'global',
        estimated_tokens: 100,
        content: 'Always respond in Korean. Never skip the checklist. Use clear and concise language.',
      },
      scan: {
        request_id: 'r1', session_id: 's1',
        user_prompt: 'help',
        assistant_response: 'Always respond in Korean. I will never skip the checklist as instructed.',
        injected_files: [{ path: '/test.md', category: 'global', estimated_tokens: 100 }],
        total_injected_tokens: 100, tool_calls: [],
        context_estimate: { system_tokens: 100, total_tokens: 200 },
      },
    });
    const result = textOverlapSignal.compute(input, defaultParams(textOverlapSignal));
    expect(result.score).toBeGreaterThan(0);
    expect(result.maxScore).toBe(25);
  });

  it('returns 0 when no file content', () => {
    const input = makeInput({ file: { path: '/x.md', category: 'global', estimated_tokens: 10, content: undefined } });
    const result = textOverlapSignal.compute(input, defaultParams(textOverlapSignal));
    expect(result.score).toBe(0);
  });
});

// --- Signal 3: Instruction Compliance ---
describe('instructionComplianceSignal', () => {
  it('detects compliance with directives', () => {
    const input = makeInput({
      file: {
        path: '/rules.md',
        category: 'rules',
        estimated_tokens: 50,
        content: 'You must always respond in Korean.\nNever skip this checklist.\nAlways use clear language.',
      },
      scan: {
        request_id: 'r1', session_id: 's1',
        user_prompt: 'test',
        assistant_response: 'Korean language response with clear and concise language. No checklist was skipped.',
        injected_files: [], total_injected_tokens: 0, tool_calls: [],
        context_estimate: { system_tokens: 50, total_tokens: 100 },
      },
    });
    const result = instructionComplianceSignal.compute(input, defaultParams(instructionComplianceSignal));
    expect(result.signalId).toBe('instruction-compliance');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.maxScore).toBe(20);
  });

  it('returns 0 when no file content', () => {
    const input = makeInput({ file: { path: '/x.md', category: 'global', estimated_tokens: 10, content: undefined } });
    const result = instructionComplianceSignal.compute(input, defaultParams(instructionComplianceSignal));
    expect(result.score).toBe(0);
  });
});

// --- Signal 4: Tool Reference ---
describe('toolReferenceSignal', () => {
  it('detects direct Read tool reference', () => {
    const input = makeInput();
    const result = toolReferenceSignal.compute(input, defaultParams(toolReferenceSignal));
    expect(result.signalId).toBe('tool-reference');
    expect(result.score).toBe(15); // direct_score
    expect(result.confidence).toBe(1);
  });

  it('detects indirect mention', () => {
    const input = makeInput({
      file: { path: '/project/README.md', category: 'project', estimated_tokens: 100 },
      scan: {
        request_id: 'r1', session_id: 's1',
        user_prompt: 'check README.md',
        assistant_response: 'I looked at the README.md file',
        injected_files: [{ path: '/project/README.md', category: 'project', estimated_tokens: 100 }],
        total_injected_tokens: 100,
        tool_calls: [{ index: 0, name: 'Bash', input_summary: 'npm test' }],
        context_estimate: { system_tokens: 100, total_tokens: 200 },
      },
    });
    const result = toolReferenceSignal.compute(input, defaultParams(toolReferenceSignal));
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(15); // indirect
  });

  it('returns 0 when no reference', () => {
    const input = makeInput({
      file: { path: '/obscure-file.dat', category: 'project', estimated_tokens: 10 },
      scan: {
        request_id: 'r1', session_id: 's1',
        user_prompt: 'hello',
        assistant_response: 'hi',
        injected_files: [], total_injected_tokens: 0,
        tool_calls: [],
        context_estimate: { system_tokens: 10, total_tokens: 20 },
      },
    });
    const result = toolReferenceSignal.compute(input, defaultParams(toolReferenceSignal));
    expect(result.score).toBe(0);
  });
});

// --- Signal 5: Position Effect ---
describe('positionEffectSignal', () => {
  it('gives primacy score to first file', () => {
    const input = makeInput({ position: { index: 0, total: 10 } });
    const result = positionEffectSignal.compute(input, defaultParams(positionEffectSignal));
    expect(result.score).toBe(5); // primacy
    expect(result.detail).toContain('primacy');
  });

  it('gives recency score to last file', () => {
    const input = makeInput({ position: { index: 9, total: 10 } });
    const result = positionEffectSignal.compute(input, defaultParams(positionEffectSignal));
    expect(result.score).toBe(5); // recency
    expect(result.detail).toContain('recency');
  });

  it('gives middle score to middle file', () => {
    const input = makeInput({ position: { index: 5, total: 10 } });
    const result = positionEffectSignal.compute(input, defaultParams(positionEffectSignal));
    expect(result.score).toBe(1); // middle
    expect(result.detail).toContain('middle');
  });

  it('handles single file', () => {
    const input = makeInput({ position: { index: 0, total: 1 } });
    const result = positionEffectSignal.compute(input, defaultParams(positionEffectSignal));
    expect(result.score).toBe(5);
  });
});

// --- Signal 6: Token Proportion ---
describe('tokenProportionSignal', () => {
  it('scales proportionally to token share', () => {
    const input = makeInput({
      file: { path: '/big.md', category: 'global', estimated_tokens: 2000 },
      scan: {
        request_id: 'r1', session_id: 's1',
        user_prompt: '', injected_files: [],
        total_injected_tokens: 2000, tool_calls: [],
        context_estimate: { system_tokens: 2000, total_tokens: 10000 },
      },
    });
    // 2000/10000 * 50 = 10 → capped at 5
    const result = tokenProportionSignal.compute(input, defaultParams(tokenProportionSignal));
    expect(result.score).toBe(5);
  });

  it('returns small score for small proportion', () => {
    const input = makeInput({
      file: { path: '/tiny.md', category: 'global', estimated_tokens: 10 },
      scan: {
        request_id: 'r1', session_id: 's1',
        user_prompt: '', injected_files: [],
        total_injected_tokens: 10, tool_calls: [],
        context_estimate: { system_tokens: 10, total_tokens: 10000 },
      },
    });
    // 10/10000 * 50 = 0.05
    const result = tokenProportionSignal.compute(input, defaultParams(tokenProportionSignal));
    expect(result.score).toBeCloseTo(0.05, 1);
  });
});

// --- Signal 7: Session History ---
describe('sessionHistorySignal', () => {
  it('computes bonus from previous scores', () => {
    const input = makeInput({ previousScores: [0.8, 0.7, 0.9] });
    const result = sessionHistorySignal.compute(input, defaultParams(sessionHistorySignal));
    // avg = 0.8, bonus = 0.8 * 0.8 = 0.64
    expect(result.score).toBeCloseTo(0.64, 1);
    expect(result.maxScore).toBe(10);
  });

  it('returns 0 with no history', () => {
    const input = makeInput();
    const result = sessionHistorySignal.compute(input, defaultParams(sessionHistorySignal));
    expect(result.score).toBe(0);
  });

  it('caps at max_bonus', () => {
    const input = makeInput({ previousScores: [50, 60, 70] });
    const result = sessionHistorySignal.compute(input, defaultParams(sessionHistorySignal));
    expect(result.score).toBe(10); // capped
  });
});
