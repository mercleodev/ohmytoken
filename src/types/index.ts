// Re-export from electron.d.ts for use in components
export type { PromptScan, UsageLogEntry, InjectedFile, ToolCall, AgentCall, ScanStats, HistoryEntry, DailyStats, EvidenceReport, FileEvidenceScore, SignalResult, EvidenceClassification, EvidenceEngineConfig, SignalConfig, McpInsightsResult, McpToolStat, SessionMcpAnalysis, RedundantPattern } from './electron.d';

export type ProviderType = 'claude' | 'openai' | 'gemini';

export type ProviderConfig = {
  id: string;
  type: ProviderType;
  name: string;
  organizationId?: string;
  sessionKey?: string;
  apiKey?: string;
};

export type CurrentUsageData = {
  usage: number;
  resetTime: string | null;
  sevenDay: {
    utilization: number;
    resetsAt: string | null;
  } | null;
  providerName: string;
  error?: string;
};

export type ColorSettings = {
  low: string;      // below 50%
  medium: string;   // 50-80%
  high: string;     // 80% and above
};

export type AppSettings = {
  colors: ColorSettings;
  toggleInterval: number;  // blink interval (ms)
  refreshInterval: number; // API refresh interval (minutes)
  shortcut: string;        // global shortcut (e.g. "CommandOrControl+Shift+T")
  proxyPort: number;       // proxy server port (default: 8780)
  contextLimitOverride?: number; // 0 = auto (plan-based), >0 = manual override
  notificationsEnabled?: boolean; // prompt notification overlay (default: true)
  notificationDisplayId?: number; // display id for notification overlay (0 = auto: largest external)
  showAllProjectsMemory?: boolean; // show memory from all projects in dashboard (default: false)
};

export type Config = {
  providers: ProviderConfig[];
  settings?: AppSettings;
};

// === Usage Dashboard types (CodexBar style) ===

export type UsageProviderType = 'claude' | 'codex' | 'gemini';

export type UsageWindow = {
  label: string;              // "Session", "Weekly", "Sonnet", "Pro", "Flash"
  usedPercent: number;        // 0-100
  leftPercent: number;        // 100 - usedPercent
  resetsAt: string | null;
  resetDescription: string;   // "Resets in 1h 47m"
  paceDescription?: string;   // "Behind (-40%) · Lasts to reset"
};

export type CreditBalance = {
  balanceUSD: number;
  grantedUSD?: number;
  usedUSD?: number;
  expiresAt?: string;
};

export type ProviderUsageSnapshot = {
  provider: UsageProviderType;
  displayName: string;        // "Claude", "Codex", "Gemini"
  windows: UsageWindow[];
  identity: {
    email: string | null;
    plan: string | null;      // "Max", "Pro", "Plus", "Paid", "Free"
  } | null;
  cost: {
    todayCostUSD: number;
    todayTokens: number;
    last30DaysCostUSD: number;
    last30DaysTokens: number;
  } | null;
  notice?: string;
  creditBalance?: CreditBalance;
  updatedAt: string;
  source: string;             // "oauth", "rpc", "proxy"
};

export type ProviderTokenStatus = {
  provider: UsageProviderType;
  displayName: string;
  installed: boolean;
  hasToken: boolean;
  tokenExpired: boolean;
  setupCommands: {
    install: string;
    login: string;
    refresh: string;
  };
};

// Phase 2 — split connection model (see docs/idea/runtime-first-account-optional-ux-spec.md §4).
export type TrackingState =
  | 'not_enabled'
  | 'waiting_for_activity'
  | 'active';

export type AccountInsightsState =
  | 'not_connected'
  | 'connected'
  | 'expired'
  | 'access_denied'
  | 'unavailable';

export type ProviderConnectionStatus = {
  provider: UsageProviderType;
  displayName: string;
  tracking: TrackingState;
  accountInsights: AccountInsightsState;
  installed: boolean;
  hasLocalCredential: boolean;
  tokenExpired: boolean;
  lastTrackedAt: string | null;
  setupCommands: {
    install: string;
    login: string;
    refresh: string;
  };
};
