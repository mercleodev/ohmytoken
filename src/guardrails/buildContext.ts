import type { PromptScan, UsageLogEntry, TurnMetric, SessionMcpAnalysis } from '../types/electron';
import type { GuardrailContext, EvidenceSummary } from './types';
import { getContextLimit, COMPACTION_DROP_PCT } from './constants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function turnTotalTokens(t: TurnMetric): number {
  return t.cache_read_tokens + t.cache_create_tokens + t.input_tokens + t.output_tokens;
}

/**
 * Count compactions: a compaction is detected when total_context_tokens drops
 * by more than COMPACTION_DROP_PCT (20%) compared to the previous turn.
 */
export function countSessionCompactions(turnMetrics: TurnMetric[]): number {
  let count = 0;
  for (let i = 1; i < turnMetrics.length; i++) {
    const prev = turnMetrics[i - 1].total_context_tokens;
    const curr = turnMetrics[i].total_context_tokens;
    if (prev > 0 && curr < prev * (1 - COMPACTION_DROP_PCT)) {
      count++;
    }
  }
  return count;
}

function buildEvidenceSummary(scan: PromptScan): EvidenceSummary {
  const report = scan.evidence_report;
  const files = report?.files ?? [];

  let confirmed = 0;
  let likely = 0;
  let unverified = 0;

  // Build a classification lookup from the evidence report
  const classificationMap = new Map<string, 'confirmed' | 'likely' | 'unverified'>();
  for (const f of files) {
    classificationMap.set(f.filePath, f.classification);
    if (f.classification === 'confirmed') confirmed++;
    else if (f.classification === 'likely') likely++;
    else if (f.classification === 'unverified') unverified++;
  }

  // Find low-value candidates among injected files
  const lowValueCandidates: EvidenceSummary['lowValueCandidates'] = [];
  for (const file of scan.injected_files ?? []) {
    const path = (file as { path: string }).path;
    const tokens = (file as { estimated_tokens: number }).estimated_tokens;
    const cls = classificationMap.get(path);

    if (cls === 'unverified') {
      lowValueCandidates.push({ path, estimatedTokens: tokens, classification: 'unverified' });
    } else if (cls === 'likely') {
      lowValueCandidates.push({ path, estimatedTokens: tokens, classification: 'likely' });
    }
  }

  return { confirmed, likely, unverified, lowValueCandidates };
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export function buildContext(
  scan: PromptScan,
  usage: UsageLogEntry | null,
  turnMetrics: TurnMetric[],
  mcpAnalysis?: SessionMcpAnalysis,
): GuardrailContext {
  const contextLimit = getContextLimit(scan.model);
  const len = turnMetrics.length;

  // Latest turn values
  const latest = len > 0 ? turnMetrics[len - 1] : null;
  const currentContextTokens = latest?.total_context_tokens ?? 0;
  const latestOutputTokens = latest?.output_tokens ?? 0;
  const latestTurnCostUsd = latest?.cost_usd ?? 0;

  // Session aggregates
  const sessionCostUsd = turnMetrics.reduce((sum, t) => sum + t.cost_usd, 0);
  const sessionTotalTokens = turnMetrics.reduce((sum, t) => sum + turnTotalTokens(t), 0);
  const sessionCacheRead = turnMetrics.reduce((sum, t) => sum + t.cache_read_tokens, 0);
  const sessionCacheReadPct = sessionTotalTokens > 0 ? sessionCacheRead / sessionTotalTokens : 0;

  // Last 3 turns output ratio
  const last3 = turnMetrics.slice(-3);
  let last3OutputRatio: number | null = null;
  if (last3.length > 0) {
    const last3Output = last3.reduce((s, t) => s + t.output_tokens, 0);
    const last3Total = last3.reduce((s, t) => s + turnTotalTokens(t), 0);
    last3OutputRatio = last3Total > 0 ? last3Output / last3Total : null;
  }

  // Cost stats
  const costs = turnMetrics.map((t) => t.cost_usd);
  const avgTurnCostUsd = costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : null;
  const medianTurnCostUsd = median(costs);

  return {
    scan,
    usage,
    turnMetrics,
    mcpAnalysis,
    contextLimit,
    sessionCompactions: countSessionCompactions(turnMetrics),
    derived: {
      turnCount: len,
      currentContextTokens,
      currentContextPct: contextLimit > 0 ? currentContextTokens / contextLimit : 0,
      latestTurnCostUsd,
      latestOutputTokens,
      sessionCostUsd,
      sessionTotalTokens,
      sessionCacheReadPct,
      last3OutputRatio: len > 0 ? last3OutputRatio : null,
      avgTurnCostUsd,
      medianTurnCostUsd,
      evidenceSummary: buildEvidenceSummary(scan),
    },
  };
}
