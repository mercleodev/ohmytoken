import {
  Config,
  ProviderConfig,
  CurrentUsageData,
  AppSettings,
  UsageProviderType,
  ProviderUsageSnapshot,
  ProviderConnectionStatus,
  AccountInsightsState,
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
  provider?: string;
  git_branch?: string;
  project_path?: string;
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

// --- Token Output Productivity Types ---

export type TokenCompositionResult = {
  cache_read: number;
  cache_create: number;
  input: number;
  output: number;
  total: number;
};

export type OutputProductivityResult = {
  todayOutputTokens: number;
  todayTotalTokens: number;
  todayOutputRatio: number;
  todayCostUSD: number;
  last7DaysOutputTokens: number;
  last7DaysTotalTokens: number;
  last7DaysOutputRatio: number;
};

export type TurnMetric = {
  turnIndex: number;
  timestamp: string;
  request_id: string;
  cache_read_tokens: number;
  cache_create_tokens: number;
  input_tokens: number;
  output_tokens: number;
  total_context_tokens: number;
  cost_usd: number;
};

export type EfficiencyGrade = 'A' | 'B' | 'C' | 'D';

export type HeatmapDay = {
  date: string;
  count: number;
};

// --- MCP Insights Types ---

export type McpToolStat = {
  name: string;
  callCount: number;
  totalResultTokens: number;
};

export type McpInsightsResult = {
  totalMcpCalls: number;
  totalToolCalls: number;
  mcpCallRatio: number;
  totalToolResultTokens: number;
  mcpToolStats: McpToolStat[];
  redundantCallCount: number;
};

export type RedundantPattern = {
  toolName: string;
  count: number;
  description: string;
};

export type SessionMcpAnalysis = {
  totalToolCalls: number;
  mcpCalls: number;
  toolResultTokens: number;
  toolBreakdown: Record<string, number>;
  redundantPatterns: RedundantPattern[];
};

// --- Harness Candidate Types (Workflow Change Recommendations) ---

export type MemoryFile = {
  fileName: string;
  name: string;
  description: string;
  type: string;
  lineCount: number;
  content: string;
};

export type MemoryStatus = {
  indexLineCount: number;
  indexMaxLines: number;
  indexContent: string;
  files: MemoryFile[];
  memoryDir: string;
};

export type ProjectMemorySummary = {
  projectPath: string;
  projectName: string;
  encodedDir: string;
  indexLineCount: number;
  indexMaxLines: number;
  fileCount: number;
  totalLines: number;
  types: Record<string, number>;
  isCurrentProject: boolean;
};

export type AllProjectsMemorySummary = {
  projects: ProjectMemorySummary[];
};

export type HarnessCandidateKind =
  | 'script'
  | 'cdp'
  | 'prompt_template'
  | 'checklist'
  | 'unknown';

export type HarnessCandidate = {
  toolName: string;
  inputSummary: string;
  signature: string;
  provider: string;
  repeatCount: number;
  promptCount: number;
  sessionCount: number;
  firstSeen: string;
  lastSeen: string;
  totalCostUsd: number;
  totalToolResultTokens: number;
  isMcp: boolean;
  candidateKind: HarnessCandidateKind;
  confidence: number;
  score: number;
  reason: string;
  suggestedAction: string;
  sampleRequestIds?: string[];
};

export type ArtifactKind = 'script' | 'command' | 'checklist' | 'context_profile' | 'markdown_brief';

export type PreviewWorkflowDraftResult = {
  artifactKind: ArtifactKind;
  title: string;
  suggestedPath: string;
  content: string;
};

export type ExportWorkflowDraftResult = {
  success: boolean;
  exportedPath: string;
  overwritten: boolean;
  error?: string;
};

export type WorkflowActionType = 'previewed' | 'exported' | 'dismissed' | 'marked_adopted';

// --- Backfill Types ---

export type BackfillProgress = {
  phase: 'scanning' | 'parsing' | 'writing' | 'done';
  totalFiles: number;
  processedFiles: number;
  discoveredMessages: number;
  insertedMessages: number;
  skippedDuplicates: number;
  errors: number;
};

export type BackfillResult = {
  totalFiles: number;
  processedFiles: number;
  insertedMessages: number;
  skippedDuplicates: number;
  errors: number;
  totalCostUsd: number;
  dateRange: { earliest: string; latest: string } | null;
  durationMs: number;
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
  getDailyStats: (provider?: string) => Promise<DailyStats | null>;
  getHistoryPromptDetail: (
    sessionId: string,
    timestamp: number,
  ) => Promise<{ scan: PromptScan; usage: UsageLogEntry | null } | null>;
  onNewHistoryEntry: (callback: (entry: HistoryEntry) => void) => () => void;
  getPromptScans: (options?: {
    limit?: number;
    offset?: number;
    session_id?: string;
    provider?: string;
  }) => Promise<PromptScan[]>;
  getPromptScanDetail: (
    requestId: string,
  ) => Promise<{ scan: PromptScan; usage: UsageLogEntry | null } | null>;
  getScanStats: (provider?: string, days?: number) => Promise<ScanStats | null>;
  getPromptHeatmap: (provider?: string) => Promise<Array<{ date: string; count: number }>>;
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
  getAllProviderConnectionStatus: () => Promise<ProviderConnectionStatus[]>;
  refreshProviderUsage: (provider?: UsageProviderType) => Promise<void>;

  // Phase 3 — account insights opt-in.
  accountInsightsConnect: (
    provider: UsageProviderType,
  ) => Promise<{ success: boolean; state: AccountInsightsState; message?: string }>;
  accountInsightsDisconnect: (
    provider: UsageProviderType,
  ) => Promise<{ success: boolean; state: AccountInsightsState; message?: string }>;
  accountInsightsReconnect: (
    provider: UsageProviderType,
  ) => Promise<{ success: boolean; state: AccountInsightsState; message?: string }>;

  // Phase 4 — first-run detection.
  getFirstRunStatus: () => Promise<{
    isFirstRun: boolean;
    sessionRootsPresent: boolean;
    totalPromptCount: number;
  }>;

  onProviderTokenChanged: (
    callback: (provider: UsageProviderType) => void,
  ) => () => void;
  onProviderUsageUpdated: (
    callback: (data: {
      provider: UsageProviderType;
      snapshot: ProviderUsageSnapshot | null;
    }) => void,
  ) => () => void;

  getCostSummary: (provider?: string) => Promise<{
    todayCostUSD: number; todayTokens: number;
    last30DaysCostUSD: number; last30DaysTokens: number;
  }>;

  // Token Output Productivity API
  getTokenComposition: (
    period: 'today' | '7d' | '30d',
    provider?: string,
  ) => Promise<TokenCompositionResult>;
  getOutputProductivity: (provider?: string) => Promise<OutputProductivityResult>;
  getSessionTurnMetrics: (
    sessionId: string,
  ) => Promise<TurnMetric[]>;

  // MCP Insights API
  getMcpInsights: (period: 'today' | '7d' | '30d', provider?: string) => Promise<McpInsightsResult>;
  getSessionMcpAnalysis: (sessionId: string) => Promise<SessionMcpAnalysis>;

  // Guardrail Engine API (batch fetch)
  getGuardrailContext: (sessionId: string) => Promise<{
    turnMetrics: TurnMetric[];
    mcpAnalysis: SessionMcpAnalysis;
    harnessCandidates?: HarnessCandidate[];
  }>;

  // Harness Candidate API (Workflow Change Recommendations)
  getHarnessCandidates: (query?: {
    sessionId?: string;
    provider?: string;
    period?: 'today' | '7d' | '30d';
    limit?: number;
  }) => Promise<HarnessCandidate[]>;

  // Memory Monitor API
  getMemoryStatus: (projectPath?: string, provider?: string) => Promise<MemoryStatus | null>;
  getAllProjectsMemorySummary: () => Promise<AllProjectsMemorySummary | null>;

  // Workflow Draft Preview API
  previewWorkflowDraft: (candidate: {
    toolName: string; inputSummary: string; candidateKind: string;
    repeatCount: number; promptCount: number; sessionCount: number;
    totalCostUsd: number; provider: string; sampleRequestIds?: string[];
  }) => Promise<PreviewWorkflowDraftResult | null>;

  // Workflow Action Tracking API
  recordWorkflowAction: (input: {
    candidateId: string;
    requestId?: string;
    sessionId?: string;
    projectPath?: string;
    actionType: WorkflowActionType;
    artifactKind?: string;
    artifactPath?: string;
  }) => Promise<{ success: boolean; id?: number; error?: string }>;

  // Workflow Draft Export API
  exportWorkflowDraft: (options: {
    suggestedPath: string;
    content: string;
    projectPath: string;
    overwrite?: boolean;
  }) => Promise<ExportWorkflowDraftResult>;

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

  // Listen for streaming prompt (user just sent message, processing...)
  onNewPromptStreaming?: (
    callback: (data: {
      sessionId: string;
      userPrompt: string;
      timestamp: string;
      model?: string;
      provider?: string;
      sessionStats?: { turns: number; costUsd: number; totalTokens: number; cacheReadPct: number };
      injectedFiles?: Array<{ path: string; category: string; estimated_tokens: number }>;
      projectFolder?: string;
    }) => void,
  ) => () => void;

  // Listen for streaming complete (assistant response finished)
  onPromptStreamingComplete?: (
    callback: (data: { sessionId: string; timestamp: string; model?: string }) => void,
  ) => () => void;

  // Navigate from notification overlay window to main window prompt detail
  navigateToPromptFromNotification: (scan: PromptScan, usage: UsageLogEntry | null) => void;

  // Toggle click-through on notification window (notification window only)
  setMouseOnCard?: (isOnCard: boolean) => void;

  // Show/hide notification window based on card visibility
  setNotificationVisible?: (visible: boolean) => void;

  // Listen for notification window click → navigate to prompt detail (main window only)
  onNotificationNavigate?: (
    callback: (data: { scan: PromptScan; usage: UsageLogEntry | null }) => void,
  ) => () => void;

  // Display info for notification placement settings
  getDisplays: () => Promise<Array<{ id: number; label: string; width: number; height: number; isPrimary: boolean }>>;

  // Navigation from tray context menu
  onNavigateTo: (callback: (view: string) => void) => () => void;

  // Backfill API
  backfillStart: () => Promise<BackfillResult>;
  backfillCancel: () => Promise<{ success: boolean }>;
  backfillCount: () => Promise<number>;
  backfillStatus: () => Promise<{ completed: boolean; lastScanTimestamp: number | null }>;
  onBackfillProgress: (callback: (progress: BackfillProgress) => void) => () => void;
  onBackfillComplete: (callback: (result: BackfillResult) => void) => () => void;
};

declare global {
  interface Window {
    api: ElectronApi;
  }
}
