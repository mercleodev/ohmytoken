/**
 * Evidence Scoring Engine — Core Types
 *
 * All numeric formulas are derived from published papers.
 * Each SignalPlugin carries its own PaperReference(s).
 */

// --- Paper & Parameter metadata ---

export type PaperReference = {
  authors: string;
  title: string;
  venue: string;
  year: number;
  identifier?: string; // arXiv ID, DOI, etc.
};

export type ParamDef = {
  key: string;
  description: string;
  type: 'number' | 'string' | 'boolean';
  default: number | string | boolean;
  min?: number;
  max?: number;
};

// --- Signal I/O ---

export type SignalInput = {
  /** The injected file being scored */
  file: {
    path: string;
    category: 'global' | 'project' | 'rules' | 'memory' | 'skill';
    estimated_tokens: number;
    content?: string; // system field content for this file
  };

  /** Full prompt scan context */
  scan: {
    request_id: string;
    session_id: string;
    user_prompt: string;
    assistant_response?: string;
    injected_files: Array<{
      path: string;
      category: string;
      estimated_tokens: number;
    }>;
    total_injected_tokens: number;
    tool_calls: Array<{
      index: number;
      name: string;
      input_summary: string;
    }>;
    context_estimate: {
      system_tokens: number;
      total_tokens: number;
    };
  };

  /** Position of this file in the system prompt (0-based index / total) */
  position: {
    index: number;
    total: number;
  };

  /** Previous evidence scores for this file in the same session (for sessionHistory) */
  previousScores?: number[];
};

export type SignalResult = {
  signalId: string;
  score: number; // 0 .. maxScore
  maxScore: number;
  confidence: number; // 0..1
  detail: string; // human-readable explanation
};

// --- Evidence Report ---

export type EvidenceClassification = 'confirmed' | 'likely' | 'unverified';

export type FileEvidenceScore = {
  filePath: string;
  category: string;
  signals: SignalResult[];
  rawScore: number; // sum before fusion
  normalizedScore: number; // 0..1
  classification: EvidenceClassification;
};

export type EvidenceReport = {
  request_id: string;
  timestamp: string;
  engine_version: string;
  fusion_method: string;
  files: FileEvidenceScore[];
  thresholds: {
    confirmed_min: number;
    likely_min: number;
  };
};

// --- Engine Configuration ---

export type SignalConfig = {
  signalId: string;
  enabled: boolean;
  weight: number; // fusion weight (0-1)
  params: Record<string, number | string | boolean>;
};

export type EvidenceEngineConfig = {
  version: string;
  enabled: boolean;
  signals: Record<string, SignalConfig>;
  fusion_method: 'weighted_sum' | 'dempster_shafer';
  thresholds: {
    confirmed_min: number;
    likely_min: number;
  };
};
