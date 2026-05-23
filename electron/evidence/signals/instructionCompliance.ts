/**
 * Signal 3: Instruction Compliance
 *
 * Measures how many directives from the file are followed in the response.
 * DRFR (Decomposed Requirement Following Rate) = complied / total × max_score.
 *
 * #357: the response corpus now includes tool-call inputs via
 * `effectiveAssistantText`, so tool-only turns register evidence. A small
 * citation bonus is added when the file's basename appears in the corpus —
 * the original "extract from <thinking>" plan was deferred because the
 * proxy does not preserve thinking blocks.
 *
 * Papers:
 *   Zhou et al. (2023) "Instruction-Following Evaluation for Large Language Models" arXiv:2311.07911
 *   Qin et al. (2024) "InFoBench" arXiv:2401.03601
 */

import type { SignalPlugin } from './types';
import { extractDirectives, checkCompliance } from '../utils/directives';
import { effectiveAssistantText } from '../utils/effectiveAssistantText';

const MIN_BASENAME_LENGTH = 4;

const basenameWithoutExtension = (filePath: string): string => {
  const base = filePath.split('/').pop() ?? filePath;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
};

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
    { key: 'citation_bonus', description: 'Score added when file basename is cited in effective text (fraction of max_score)', type: 'number', default: 0.25, min: 0, max: 1 },
  ],
  maxScore: 20,

  compute(input, params) {
    const maxScore = Number(params.max_score ?? 20);
    const citationBonusFraction = Number(params.citation_bonus ?? 0.25);

    const fileContent = input.file.content ?? '';
    const response = effectiveAssistantText(
      input.scan.assistant_response,
      input.scan.tool_calls,
    );

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
        detail: `${directives.length} directives found, but no response or tool inputs to check compliance`,
      };
    }

    const { total, complied, rate } = checkCompliance(directives, response);
    const directiveScore = rate * maxScore;

    const basename = basenameWithoutExtension(input.file.path).toLowerCase();
    const cited = basename.length >= MIN_BASENAME_LENGTH && response.toLowerCase().includes(basename);
    const citationBonus = cited ? citationBonusFraction * maxScore : 0;

    const score = Math.min(directiveScore + citationBonus, maxScore);

    const detailBase = `${complied}/${total} directives complied (${(rate * 100).toFixed(0)}%)`;
    const detail = cited
      ? `${detailBase} + citation("${basename}") → ${score.toFixed(1)}/${maxScore}`
      : `${detailBase} → ${score.toFixed(1)}/${maxScore}`;

    return {
      signalId: this.id,
      score: Math.round(score * 100) / 100,
      maxScore,
      confidence: Math.min(rate + (cited ? citationBonusFraction : 0), 1),
      detail,
    };
  },
};
