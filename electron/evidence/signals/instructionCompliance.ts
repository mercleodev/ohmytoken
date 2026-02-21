/**
 * Signal 3: Instruction Compliance
 *
 * Measures how many directives from the file are followed in the response.
 * DRFR (Decomposed Requirement Following Rate) = complied / total × max_score
 *
 * Papers:
 *   Zhou et al. (2023) "Instruction-Following Evaluation for Large Language Models" arXiv:2311.07911
 *   Qin et al. (2024) "InFoBench" arXiv:2401.03601
 */

import type { SignalPlugin } from './types';
import { extractDirectives, checkCompliance } from '../utils/directives';

export const instructionComplianceSignal: SignalPlugin = {
  id: 'instruction-compliance',
  name: 'Instruction Compliance',
  version: '1.0.0',
  papers: [
    {
      authors: 'Zhou et al.',
      title: 'Instruction-Following Evaluation for Large Language Models',
      venue: 'arXiv',
      year: 2023,
      identifier: 'arXiv:2311.07911',
    },
    {
      authors: 'Qin et al.',
      title: 'InFoBench: Evaluating Instruction Following Ability of Large Language Models',
      venue: 'arXiv',
      year: 2024,
      identifier: 'arXiv:2401.03601',
    },
  ],
  paramDefs: [
    { key: 'max_score', description: 'Maximum score for this signal', type: 'number', default: 20, min: 0, max: 50 },
  ],
  maxScore: 20,

  compute(input, params) {
    const maxScore = Number(params.max_score ?? 20);

    const fileContent = input.file.content ?? '';
    const response = input.scan.assistant_response ?? '';

    if (!fileContent) {
      return {
        signalId: this.id,
        score: 0,
        maxScore,
        confidence: 0,
        detail: 'No file content available for directive extraction',
      };
    }

    const directives = extractDirectives(fileContent);

    if (directives.length === 0) {
      // File has no extractable directives — neutral score
      return {
        signalId: this.id,
        score: 0,
        maxScore,
        confidence: 0,
        detail: 'No directives found in file',
      };
    }

    if (!response) {
      return {
        signalId: this.id,
        score: 0,
        maxScore,
        confidence: 0.5,
        detail: `${directives.length} directives found, but no response to check compliance`,
      };
    }

    const { total, complied, rate } = checkCompliance(directives, response);
    const score = Math.min(rate * maxScore, maxScore);

    return {
      signalId: this.id,
      score: Math.round(score * 100) / 100,
      maxScore,
      confidence: rate,
      detail: `${complied}/${total} directives complied (${(rate * 100).toFixed(0)}%) → ${score.toFixed(1)}/${maxScore}`,
    };
  },
};
