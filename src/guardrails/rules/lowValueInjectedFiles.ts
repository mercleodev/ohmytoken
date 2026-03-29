import type { GuardrailRule, GuardrailContext, GuardrailRecommendation } from '../types';
import { LOW_VALUE_INJECTED_SHARE } from '../constants';

/**
 * low-value-injected-files: fires when large injected files have weak evidence.
 *
 * Trigger:
 *  - combined candidate tokens (likely/unverified) exceed 20% of injected total
 *  - candidates are top token contributors with likely/unverified classification
 *
 * This is the only MVP rule that provides honest, verifiable token savings.
 */
export const lowValueInjectedFilesRule: GuardrailRule = {
  id: 'low-value-injected-files',
  evaluate(ctx: GuardrailContext): GuardrailRecommendation | null {
    const { evidenceSummary } = ctx.derived;
    const { scan } = ctx;

    const candidates = evidenceSummary.lowValueCandidates;
    if (candidates.length === 0) return null;

    const totalInjectedTokens = scan.total_injected_tokens;
    if (totalInjectedTokens === 0) return null;

    const candidateTokens = candidates.reduce((sum, c) => sum + c.estimatedTokens, 0);
    const candidateShare = candidateTokens / totalInjectedTokens;

    if (candidateShare < LOW_VALUE_INJECTED_SHARE) return null;

    // Dynamic confidence
    let confidence = 0.65;
    const hasUnverified = candidates.some((c) => c.classification === 'unverified');
    if (hasUnverified) confidence = Math.min(confidence + 0.10, 1.0);
    if (candidateShare >= 0.40) confidence = Math.min(confidence + 0.10, 1.0);

    const evidence: string[] = [];
    // Show top 5 candidates by token size
    const sorted = [...candidates].sort((a, b) => b.estimatedTokens - a.estimatedTokens);
    for (const c of sorted.slice(0, 5)) {
      evidence.push(`${c.path} — ${(c.estimatedTokens / 1000).toFixed(1)}K tokens (${c.classification})`);
    }
    evidence.push(`${(candidateShare * 100).toFixed(0)}% of injected context is low-value`);

    return {
      id: 'low-value-injected-files',
      severity: 'info',
      title: 'Some Injected Files Look Removable',
      reason: 'A meaningful part of injected context comes from files with weak evidence relevance.',
      action: 'Remove the highlighted files first and rerun the prompt with only confirmed context.',
      confidence,
      evidence,
      estimatedSavings: {
        tokens: candidateTokens,
        note: `Remove these files to save about ${(candidateTokens / 1000).toFixed(1)}K tokens of injected context.`,
      },
    };
  },
};
