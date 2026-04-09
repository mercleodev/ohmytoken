import type { GuardrailRule, GuardrailContext, GuardrailRecommendation } from '../types';
import type { HarnessCandidateKind } from '../../types/electron';

// ---------------------------------------------------------------------------
// User-facing label mapping (internal kind → visible label)
// ---------------------------------------------------------------------------

const VISIBLE_LABELS: Record<HarnessCandidateKind, string> = {
  script: 'Reusable Script Candidate',
  cdp: 'Browser Automation Candidate',
  prompt_template: 'Reusable Command Candidate',
  checklist: 'Reusable Checklist Candidate',
  unknown: '',
};

const REASON_TEMPLATES: Record<HarnessCandidateKind, string> = {
  script: 'This command flow repeated {count} times across {sessions} session(s). Move it into a reusable script.',
  cdp: 'This browser interaction pattern repeated {count} times. Move it into browser automation.',
  prompt_template: 'This request shell repeats with small target changes. Turn it into a reusable command.',
  checklist: 'This review flow repeats across sessions. Save it as a reusable checklist.',
  unknown: 'A repeated tool pattern was detected ({count} times).',
};

const ACTION_TEMPLATES: Record<HarnessCandidateKind, string> = {
  script: 'Extract repeated commands into scripts/<slug>.sh',
  cdp: 'Extract browser flow into automation/<slug>.md',
  prompt_template: 'Create a reusable command at .claude/commands/<slug>.md',
  checklist: 'Save as a checklist at .claude/checklists/<slug>.md',
  unknown: 'Review this repeated pattern for potential reuse.',
};

// ---------------------------------------------------------------------------
// Minimum thresholds to surface a recommendation
// ---------------------------------------------------------------------------

const MIN_CONFIDENCE = 0.25;

// ---------------------------------------------------------------------------
// Rule implementation
// ---------------------------------------------------------------------------

export const harnessCandidateRule: GuardrailRule = {
  id: 'harness-candidate',
  evaluate(ctx: GuardrailContext): GuardrailRecommendation | null {
    const candidates = ctx.harnessCandidates;
    if (!candidates || candidates.length === 0) return null;

    // Pick the top visible candidate (skip 'unknown')
    const top = candidates.find((c) => c.candidateKind !== 'unknown')
      ?? candidates[0];

    if (top.candidateKind === 'unknown') return null;
    if (top.confidence < MIN_CONFIDENCE) return null;

    const kind = top.candidateKind;
    const label = VISIBLE_LABELS[kind];

    // Use the pre-computed reason/action from the reader (already includes input summary)
    const reason = top.reason || REASON_TEMPLATES[kind]
      .replace('{count}', String(top.repeatCount))
      .replace('{sessions}', String(top.sessionCount));

    const action = top.suggestedAction || ACTION_TEMPLATES[kind];

    const evidence: string[] = [
      `${top.toolName}: repeated ${top.repeatCount}x across ${top.promptCount} prompt(s)`,
    ];
    if (top.sessionCount > 1) {
      evidence.push(`Spread across ${top.sessionCount} sessions`);
    }
    if (top.totalCostUsd > 0) {
      evidence.push(`Estimated cost impact: $${top.totalCostUsd.toFixed(4)}`);
    }

    const severity = top.confidence >= 0.7 ? 'warning' as const : 'info' as const;

    return {
      id: 'harness-candidate',
      severity,
      title: label,
      reason,
      action,
      confidence: top.confidence,
      evidence,
      estimatedSavings: top.totalCostUsd > 0
        ? {
            costUsd: top.totalCostUsd * 0.5,
            tokens: top.totalToolResultTokens,
            note: `Potential savings if ${top.toolName} calls are reused`,
          }
        : undefined,
    };
  },
};
