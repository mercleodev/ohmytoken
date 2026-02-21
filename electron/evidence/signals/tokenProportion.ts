/**
 * Signal 6: Token Proportion
 *
 * Score based on how much of the total context this file occupies.
 * score = min((file_tokens / total_tokens) × multiplier, max_score)
 *
 * Papers:
 *   Vaswani et al. (2017) "Attention Is All You Need" arXiv:1706.03762
 *   Jiang et al. (2023) "LLMLingua" arXiv:2310.05736
 */

import type { SignalPlugin } from './types';

export const tokenProportionSignal: SignalPlugin = {
  id: 'token-proportion',
  name: 'Token Proportion',
  version: '1.0.0',
  papers: [
    {
      authors: 'Vaswani et al.',
      title: 'Attention Is All You Need',
      venue: 'NeurIPS',
      year: 2017,
      identifier: 'arXiv:1706.03762',
    },
    {
      authors: 'Jiang et al.',
      title: 'LLMLingua: Compressing Prompts for Accelerated Inference of Large Language Models',
      venue: 'EMNLP',
      year: 2023,
      identifier: 'arXiv:2310.05736',
    },
  ],
  paramDefs: [
    { key: 'multiplier', description: 'Scale factor for proportion', type: 'number', default: 50, min: 1, max: 200 },
    { key: 'max_score', description: 'Maximum score for this signal', type: 'number', default: 5, min: 0, max: 50 },
  ],
  maxScore: 5,

  compute(input, params) {
    const multiplier = Number(params.multiplier ?? 50);
    const maxScore = Number(params.max_score ?? 5);

    const fileTokens = input.file.estimated_tokens;
    const totalTokens = input.scan.context_estimate.total_tokens;

    if (totalTokens === 0) {
      return {
        signalId: this.id,
        score: 0,
        maxScore,
        confidence: 0,
        detail: 'Total tokens is zero',
      };
    }

    const proportion = fileTokens / totalTokens;
    const raw = proportion * multiplier;
    const score = Math.min(raw, maxScore);

    return {
      signalId: this.id,
      score: Math.round(score * 100) / 100,
      maxScore,
      confidence: Math.min(proportion * 10, 1), // Higher proportion = higher confidence
      detail: `${fileTokens}/${totalTokens} tokens (${(proportion * 100).toFixed(1)}%) × ${multiplier} → ${score.toFixed(1)}/${maxScore}`,
    };
  },
};
