import type { UsageProviderType } from './providers/usage/types';

export type ProviderType = 'claude' | 'openai' | 'gemini';

export type ProviderConfig = {
  id: string;
  type: ProviderType;
  name: string;
  organizationId?: string;
  sessionKey?: string;
  apiKey?: string;
};

export type UsageData = {
  fiveHour?: {
    utilization: number;
    resetsAt: string | null;
  };
  sevenDay?: {
    utilization: number;
    resetsAt: string | null;
  };
};

export type CurrentUsageData = {
  usage: number;
  resetTime: string | null;
  sevenDay: UsageData['sevenDay'] | null;
  providerName: string;
  error?: string;
};

export type ColorSettings = {
  low: string;      // Below 50%
  medium: string;   // 50-80%
  high: string;     // Above 80%
};

export type AppSettings = {
  colors: ColorSettings;
  toggleInterval: number;  // Tray display toggle interval (ms). 0 disables auto-toggle.
  refreshInterval: number; // API refresh interval (minutes)
  shortcut: string;        // Global shortcut (e.g., "CommandOrControl+Shift+T")
  proxyPort: number;       // Proxy server port (default: 8780)
  contextLimitOverride?: number; // 0 = auto (plan-based), >0 = manual override
  notificationsEnabled?: boolean; // Prompt notification overlay (default: true)
  notificationDisplayId?: number; // Display id for notification overlay (0 = auto: largest external)
  showAllProjectsMemory?: boolean; // Show memory from all projects in dashboard (default: false)
  // Phase 3 — per-provider opt-in for account insights (quota/plan/credit lookups).
  // Missing or false means tracking-only mode; no eager credential probing.
  accountInsights?: Partial<Record<UsageProviderType, boolean>>;
};

export type StoreData = {
  providers: ProviderConfig[];
  settings?: AppSettings;
  evidenceConfig?: import('./evidence/types').EvidenceEngineConfig;
};

export type ProxyStatus = {
  running: boolean;
  port: number | null;
  upstream: string | null;
  requests_total: number;
  errors_total: number;
};
