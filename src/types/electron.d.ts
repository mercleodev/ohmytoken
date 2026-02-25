import {
  Config,
  ProviderConfig,
  CurrentUsageData,
  AppSettings,
  UsageProviderType,
  ProviderUsageSnapshot,
  ProviderTokenStatus,
} from "./index";

export type HistoryEntry = {
  display: string;
  timestamp: number;
  sessionId: string;
  project: string;
  // Enriched by main process (from session JSONL usage data)
  totalContextTokens?: number;
  model?: string;
};

export type DailyStats = {
  date: string;
  messageCount: number;
  sessionCount: number;
  toolCallCount: number;
  tokensByModel: Record<string, number>;
};

export type InjectedFile = {
  path: string;
  category: "global" | "project" | "rules" | "memory" | "skill";
  estimated_tokens: number;
};

export type ToolCall = {
  index: number;
  name: string;
  input_summary: string;
  timestamp?: string;
};

export type AgentCall = {
  index: number;
  subagent_type: string;
  description: string;
};

export type PromptScan = {
  request_id: string;
  session_id: string;
  timestamp: string;
  user_prompt: string;
  user_prompt_tokens: number;
  assistant_response?: string;
  injected_files: InjectedFile[];
  total_injected_tokens: number;
  tool_calls: ToolCall[];
  tool_summary: Record<string, number>;
  agent_calls: AgentCall[];
  context_estimate: {
    system_tokens: number;
    messages_tokens: number;
    messages_tokens_breakdown?: {
      user_text_tokens: number;
      assistant_tokens: number;
      tool_result_tokens: number;
    };
    tools_definition_tokens: number;
    total_tokens: number;
  };
  model: string;
  max_tokens: number;
  conversation_turns: number;
  user_messages_count: number;
  assistant_messages_count: number;
  tool_result_count: number;
  evidence_report?: EvidenceReport;
};

// --- Evidence Scoring Types ---

export type EvidenceClassification = "confirmed" | "likely" | "unverified";

export type SignalResult = {
  signalId: string;
  score: number;
  maxScore: number;
  confidence: number;
  detail: string;
};

export type FileEvidenceScore = {
  filePath: string;
  category: string;
  signals: SignalResult[];
  rawScore: number;
  normalizedScore: number;
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

export type SignalConfig = {
  signalId: string;
  enabled: boolean;
  weight: number;
  params: Record<string, number | string | boolean>;
};

export type EvidenceEngineConfig = {
  version: string;
  enabled: boolean;
  signals: Record<string, SignalConfig>;
  fusion_method: "weighted_sum" | "dempster_shafer";
  thresholds: {
    confirmed_min: number;
    likely_min: number;
  };
};

export type UsageLogEntry = {
  timestamp: string;
  request_id: string;
  session_id: string;
  model: string;
  request: {
    messages_count: number;
    tools_count: number;
    has_system: boolean;
    max_tokens: number;
  };
  response: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  cost_usd: number;
  duration_ms: number;
};

export type ScanStats = {
  cost_by_time: Array<{ timestamp: string; model: string; cost_usd: number }>;
  tool_frequency: Record<string, number>;
  injected_file_tokens: Array<{
    path: string;
    total_tokens: number;
    percentage: number;
  }>;
  cache_hit_rate: Array<{ timestamp: string; hit_rate: number }>;
  cost_by_period: Array<{
    period: string;
    cost_usd: number;
    request_count: number;
  }>;
  summary: {
    total_requests: number;
    total_cost_usd: number;
    avg_context_tokens: number;
    most_used_tool: string;
    cache_hit_rate: number;
  };
};

export type ElectronApi = {
  saveConfig: (config: Config) => Promise<{ success: boolean }>;
  getConfig: () => Promise<Config>;
  addProvider: (provider: ProviderConfig) => Promise<{ success: boolean }>;
  removeProvider: (providerId: string) => Promise<{ success: boolean }>;
  refreshUsage: () => Promise<{ success: boolean }>;
  getUsageData: () => Promise<CurrentUsageData & { settings: AppSettings }>;
  saveSettings: (settings: AppSettings) => Promise<{ success: boolean }>;
  getRecentHistory: (limit?: number) => Promise<HistoryEntry[]>;
  getDailyStats: () => Promise<DailyStats | null>;
  getHistoryPromptDetail: (
    sessionId: string,
    timestamp: number,
  ) => Promise<{ scan: PromptScan; usage: UsageLogEntry | null } | null>;
  onNewHistoryEntry: (callback: (entry: HistoryEntry) => void) => () => void;
  getPromptScans: (options?: {
    limit?: number;
    offset?: number;
    session_id?: string;
  }) => Promise<PromptScan[]>;
  getPromptScanDetail: (
    requestId: string,
  ) => Promise<{ scan: PromptScan; usage: UsageLogEntry | null } | null>;
  getScanStats: () => Promise<ScanStats | null>;
  readFileContent: (
    filePath: string,
  ) => Promise<{ content: string; error?: string }>;

  // Session-based real-time CT Scan API
  getCurrentSessionId: () => Promise<string>;
  getSessionScans: (sessionId: string) => Promise<PromptScan[]>;
  onNewPromptScan: (
    callback: (data: { scan: PromptScan; usage: UsageLogEntry }) => void,
  ) => () => void;

  // Usage Dashboard API (CodexBar style)
  getProviderUsage: (
    provider: UsageProviderType,
  ) => Promise<ProviderUsageSnapshot | null>;
  getAllProviderStatus: () => Promise<ProviderTokenStatus[]>;
  refreshProviderUsage: (provider?: UsageProviderType) => Promise<void>;
  onProviderTokenChanged: (
    callback: (provider: UsageProviderType) => void,
  ) => () => void;
  onProviderUsageUpdated: (
    callback: (data: {
      provider: UsageProviderType;
      snapshot: ProviderUsageSnapshot | null;
    }) => void,
  ) => () => void;

  // Evidence Scoring API
  getEvidenceReport: (requestId: string) => Promise<EvidenceReport | null>;
  getEvidenceConfig: () => Promise<EvidenceEngineConfig>;
  updateEvidenceConfig: (
    config: Partial<EvidenceEngineConfig>,
  ) => Promise<{ success: boolean }>;
  rescoreEvidence: (requestId: string) => Promise<EvidenceReport | null>;
  onEvidenceScored: (
    callback: (data: {
      requestId: string;
      report: EvidenceReport;
    }) => void,
  ) => () => void;

  // Navigation from tray context menu
  onNavigateTo: (callback: (view: string) => void) => () => void;
};

declare global {
  interface Window {
    api: ElectronApi;
  }
}
