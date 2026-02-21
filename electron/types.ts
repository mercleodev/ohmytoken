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
  toggleInterval: number;  // Blink interval (ms)
  refreshInterval: number; // API refresh interval (minutes)
  shortcut: string;        // Global shortcut (e.g., "CommandOrControl+Shift+T")
  proxyPort: number;       // Proxy server port (default: 8780)
  contextLimitOverride?: number; // 0 = auto (plan-based), >0 = manual override
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
