/**
 * Signal 8: Decision-Gate Ack
 *
 * The strongest evidence signal: an explicit, deterministic ack token that
 * the LLM emits when it has engaged with a rule. Avoids the noise of n-gram
 * overlap and keyword-based compliance detection — the LLM either emits the
 * token or it doesn't.
 *
 * Rules opt in by adding a `<!-- canary:CANARY-<id> -->` marker (reusing the
 * canary-refs system many users already drive from a global CLAUDE.md) plus
 * an instruction telling the LLM to terminate its response with:
 *
 *   [RULE-ACK:CANARY-<id>=USED:<one-line summary>]            → confirmed
 *   [RULE-ACK:CANARY-<id>=NOT_APPLICABLE:<one-line reason>]   → likely (capped)
 *
 * The signal scans `effectiveAssistantText` (assistant_response + tool input
 * summaries) for these tokens and matches the canary id against the file's
 * own `canary:CANARY-<id>` marker, falling back to its basename.
 *
 * Repo-agnostic: opting in is the rule owner's choice. Rules without the
 * marker simply score 0 here and fall back to the other evidence signals.
 *
 * See #352 epic and #359.
 */

import type { SignalPlugin } from './types';
import { effectiveAssistantText } from '../utils/effectiveAssistantText';

const ACK_TOKEN_PATTERN = /\[RULE-ACK:CANARY-([A-Za-z0-9_-]+)=(USED|NOT_APPLICABLE)(?::([^\]]*))?\]/g;
const FILE_CANARY_PATTERN = /<!--\s*canary:CANARY-([A-Za-z0-9_-]+)\s*-->/i;

const basenameId = (filePath: string): string => {
  const base = filePath.split('/').pop() ?? filePath;
  const dot = base.lastIndexOf('.');
  return (dot > 0 ? base.slice(0, dot) : base).toLowerCase();
};

const fileCanaryId = (content: string | undefined): string | null => {
  if (!content) return null;
  const m = content.match(FILE_CANARY_PATTERN);
  return m ? m[1].toLowerCase() : null;
};

type AckHit = { id: string; verdict: 'USED' | 'NOT_APPLICABLE'; note: string };

const extractAcks = (text: string): AckHit[] => {
  const hits: AckHit[] = [];
  ACK_TOKEN_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ACK_TOKEN_PATTERN.exec(text)) !== null) {
    hits.push({
      id: m[1].toLowerCase(),
      verdict: m[2] as 'USED' | 'NOT_APPLICABLE',
      note: (m[3] ?? '').trim(),
    });
  }
  return hits;
};

export const decisionGateAckSignal: SignalPlugin = {
  id: 'decision-gate-ack',
  name: 'Decision-Gate Ack',
  version: '1.0.0',
  kind: 'evidence',
  papers: [
    {
      authors: 'OhMyToken',
      title: 'Decision-Gate Ack Protocol',
      venue: 'Internal (issue #359)',
      year: 2026,
    },
  ],
  paramDefs: [
    { key: 'used_score', description: 'Score when ack token says USED', type: 'number', default: 30, min: 0, max: 50 },
    { key: 'not_applicable_score', description: 'Score when ack token says NOT_APPLICABLE', type: 'number', default: 12, min: 0, max: 30 },
    { key: 'max_score', description: 'Maximum score for this signal', type: 'number', default: 30, min: 0, max: 50 },
  ],
  maxScore: 30,

  compute(input, params) {
    const usedScore = Number(params.used_score ?? 30);
    const notApplicableScore = Number(params.not_applicable_score ?? 12);
    const maxScore = Number(params.max_score ?? 30);

    const corpus = effectiveAssistantText(
      input.scan.assistant_response,
      input.scan.tool_calls,
    );

    if (!corpus) {
      return {
        signalId: this.id,
        score: 0,
        maxScore,
        confidence: 0,
        detail: 'No assistant text or tool inputs to scan for ack tokens',
      };
    }

    const hits = extractAcks(corpus);
    if (hits.length === 0) {
      return {
        signalId: this.id,
        score: 0,
        maxScore,
        confidence: 0,
        detail: 'No [RULE-ACK:...] tokens in response',
      };
    }

    const fileId = fileCanaryId(input.file.content);
    const fallbackId = basenameId(input.file.path);

    const match = hits.find(
      (h) => (fileId !== null && h.id === fileId) || h.id === fallbackId,
    );

    if (!match) {
      return {
        signalId: this.id,
        score: 0,
        maxScore,
        confidence: 0,
        detail: `Ack tokens present but none match this file (id="${fileId ?? fallbackId}")`,
      };
    }

    const isUsed = match.verdict === 'USED';
    const score = Math.min(isUsed ? usedScore : notApplicableScore, maxScore);
    const confidence = isUsed ? 1 : 0.5;
    const note = match.note.slice(0, 80);
    const detail = isUsed
      ? `LLM acknowledged USED: "${note}" → ${score}/${maxScore}`
      : `LLM acknowledged NOT_APPLICABLE: "${note}" → ${score}/${maxScore}`;

    return {
      signalId: this.id,
      score: Math.round(score * 100) / 100,
      maxScore,
      confidence,
      detail,
    };
  },
};
