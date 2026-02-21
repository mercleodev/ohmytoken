/**
 * Weighted Sum Fusion — default strategy.
 *
 * total = Σ(score_i × weight_i) / Σ(maxScore_i × weight_i)
 *
 * Simple, interpretable, and sufficient for most use cases.
 */

import type { FusionStrategy } from './types';

export const weightedSumFusion: FusionStrategy = {
  id: 'weighted_sum',
  name: 'Weighted Sum',
  papers: [],

  combine({ signals, weights }) {
    let weightedScore = 0;
    let activeWeightedMax = 0;

    for (const s of signals) {
      const w = weights[s.signalId] ?? 1;
      weightedScore += s.score * w;
      // Only count signals that contributed (score > 0) toward the denominator
      // so inactive signals don't dilute the normalized score
      if (s.score > 0) {
        activeWeightedMax += s.maxScore * w;
      }
    }

    const normalizedScore = activeWeightedMax > 0 ? weightedScore / activeWeightedMax : 0;

    return {
      rawScore: Math.round(weightedScore * 100) / 100,
      normalizedScore: Math.round(normalizedScore * 1000) / 1000,
      method: 'weighted_sum',
    };
  },
};
