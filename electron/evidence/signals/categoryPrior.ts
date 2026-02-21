/**
 * Signal 1: Category Prior
 *
 * Bayesian prior based on file category.
 * P(c|x) ∝ P(x|c) · P(c) → score = (prior[category] / Σpriors) × max_score
 *
 * Papers:
 *   McCallum & Nigam (1998) "A Comparison of Event Models for Naive Bayes Text Classification" AAAI
 *   Raschka (2014) "Naive Bayes and Text Classification" arXiv:1410.5329
 */

import type { SignalPlugin } from './types';

const CATEGORY_KEYS = ['global', 'project', 'rules', 'memory', 'skill'] as const;

export const categoryPriorSignal: SignalPlugin = {
  id: 'category-prior',
  name: 'Category Prior',
  version: '1.0.0',
  papers: [
    {
      authors: 'McCallum & Nigam',
      title: 'A Comparison of Event Models for Naive Bayes Text Classification',
      venue: 'AAAI Workshop on Learning for Text Categorization',
      year: 1998,
    },
    {
      authors: 'Raschka',
      title: 'Naive Bayes and Text Classification I',
      venue: 'arXiv',
      year: 2014,
      identifier: 'arXiv:1410.5329',
    },
  ],
  paramDefs: [
    { key: 'prior_global', description: 'Prior weight for global category', type: 'number', default: 25, min: 0, max: 100 },
    { key: 'prior_project', description: 'Prior weight for project category', type: 'number', default: 25, min: 0, max: 100 },
    { key: 'prior_rules', description: 'Prior weight for rules category', type: 'number', default: 25, min: 0, max: 100 },
    { key: 'prior_memory', description: 'Prior weight for memory category', type: 'number', default: 20, min: 0, max: 100 },
    { key: 'prior_skill', description: 'Prior weight for skill category', type: 'number', default: 10, min: 0, max: 100 },
    { key: 'max_score', description: 'Maximum score for this signal', type: 'number', default: 30, min: 0, max: 100 },
  ],
  maxScore: 30,

  compute(input, params) {
    const maxScore = Number(params.max_score ?? 30);
    const category = input.file.category;

    // Collect priors for all categories
    const priors: Record<string, number> = {};
    let sumPriors = 0;
    for (const key of CATEGORY_KEYS) {
      const val = Number(params[`prior_${key}`] ?? 0);
      priors[key] = val;
      sumPriors += val;
    }

    if (sumPriors === 0) {
      return {
        signalId: this.id,
        score: 0,
        maxScore,
        confidence: 0,
        detail: 'All priors are zero',
      };
    }

    const prior = priors[category] ?? 0;
    const score = (prior / sumPriors) * maxScore;

    return {
      signalId: this.id,
      score: Math.round(score * 100) / 100,
      maxScore,
      confidence: prior / sumPriors,
      detail: `Category "${category}" prior=${prior}/${sumPriors} → ${score.toFixed(1)}/${maxScore}`,
    };
  },
};
