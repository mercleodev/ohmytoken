import type { PromptScan, UsageLogEntry, TurnMetric, SessionMcpAnalysis, HarnessCandidate } from '../types/electron';

// ---------------------------------------------------------------------------
// Severity & confidence
// ---------------------------------------------------------------------------

export type GuardrailSeverity = 'info' | 'warning' | 'critical';

// ---------------------------------------------------------------------------
// Recommendation — single actionable output from one rule
// ---------------------------------------------------------------------------

export type GuardrailRecommendation = {
  id: string;
  severity: GuardrailSeverity;
  title: string;
  reason: string;
  action: string;
  /** 0.0–1.0 — how certain the engine is (not how severe) */
  confidence: number;
  evidence: string[];
  estimatedSavings?: {
    tokens?: number;
    costUsd?: number;
    note: string;
  };
};

// ---------------------------------------------------------------------------
// Assessment — full engine output for one scan
// ---------------------------------------------------------------------------

export type GuardrailAssessment = {
  generatedAt: string;
  primary: GuardrailRecommendation | null;
  secondary: GuardrailRecommendation[];
  all: GuardrailRecommendation[];
  summary: {
    sessionHealth: 'healthy' | 'watch' | 'risky';
    topRiskIds: string[];
  };
};

// ---------------------------------------------------------------------------
// Evidence summary — derived from injected files + evidence report
// ---------------------------------------------------------------------------

export type EvidenceSummary = {
  confirmed: number;
  likely: number;
  unverified: number;
  lowValueCandidates: Array<{
    path: string;
    estimatedTokens: number;
    classification: 'likely' | 'unverified';
  }>;
};

// ---------------------------------------------------------------------------
// GuardrailContext — normalized input for all rules
// ---------------------------------------------------------------------------

export type GuardrailContext = {
  scan: PromptScan;
  usage: UsageLogEntry | null;
  turnMetrics: TurnMetric[];
  mcpAnalysis?: SessionMcpAnalysis;
  harnessCandidates?: HarnessCandidate[];
  contextLimit: number;
  sessionCompactions: number;
  derived: {
    turnCount: number;
    currentContextTokens: number;
    currentContextPct: number;
    latestTurnCostUsd: number;
    latestOutputTokens: number;
    sessionCostUsd: number;
    sessionTotalTokens: number;
    sessionCacheReadPct: number;
    last3OutputRatio: number | null;
    avgTurnCostUsd: number | null;
    medianTurnCostUsd: number | null;
    evidenceSummary: EvidenceSummary;
  };
};

// ---------------------------------------------------------------------------
// Rule interface — each rule is a pure function
// ---------------------------------------------------------------------------

export type GuardrailRule = {
  id: string;
  evaluate: (ctx: GuardrailContext) => GuardrailRecommendation | null;
};
