import { contextBridge, ipcRenderer } from "electron";
import {
  ProviderConfig,
  CurrentUsageData,
  AppSettings,
  ProxyStatus,
} from "./types";
import { PromptScan, ScanStats, UsageLogEntry } from "./proxy/types";

type Config = {
  providers: ProviderConfig[];
  settings?: AppSettings;
};

const api = {
  saveConfig: (config: Config): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("save-config", config),

  getConfig: (): Promise<Config> => ipcRenderer.invoke("get-config"),

  addProvider: (provider: ProviderConfig): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("add-provider", provider),

  removeProvider: (providerId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("remove-provider", providerId),

  refreshUsage: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("refresh-usage"),

  getUsageData: (): Promise<CurrentUsageData & { settings: AppSettings }> =>
    ipcRenderer.invoke("get-usage-data"),

  saveSettings: (settings: AppSettings): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("save-settings", settings),

  scanTokens: (): Promise<any> => ipcRenderer.invoke("scan-tokens"),

  getPromptHistory: (): Promise<any[]> =>
    ipcRenderer.invoke("get-prompt-history"),

  analyzePrompt: (promptId: string): Promise<any> =>
    ipcRenderer.invoke("analyze-prompt", promptId),

  getContextLogs: (
    sessionId?: string,
  ): Promise<{
    autoInjected: string[];
    readFiles: string[];
    globSearches: Array<{ pattern: string; searchPath: string }>;
    grepSearches: Array<{ pattern: string; searchPath: string }>;
    sessionId?: string;
  }> => ipcRenderer.invoke("get-context-logs", sessionId),

  startProxy: (
    port?: number,
    upstream?: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("start-proxy", port, upstream),

  stopProxy: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke("stop-proxy"),

  getProxyStatus: (): Promise<ProxyStatus> =>
    ipcRenderer.invoke("get-proxy-status"),

  // History (passive session monitoring)
  getRecentHistory: (limit?: number): Promise<any[]> =>
    ipcRenderer.invoke("get-recent-history", limit),

  getDailyStats: (): Promise<any> => ipcRenderer.invoke("get-daily-stats"),

  getHistoryPromptDetail: (
    sessionId: string,
    timestamp: number,
  ): Promise<any> =>
    ipcRenderer.invoke("get-history-prompt-detail", sessionId, timestamp),

  onNewHistoryEntry: (callback: (entry: any) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, entry: any) =>
      callback(entry);
    ipcRenderer.on("new-history-entry", handler);
    return () => {
      ipcRenderer.removeListener("new-history-entry", handler);
    };
  },

  // CT Scan API
  getPromptScans: (options?: {
    limit?: number;
    offset?: number;
    session_id?: string;
  }): Promise<PromptScan[]> => ipcRenderer.invoke("get-prompt-scans", options),

  getPromptScanDetail: (
    requestId: string,
  ): Promise<{ scan: PromptScan; usage: UsageLogEntry | null } | null> =>
    ipcRenderer.invoke("get-prompt-scan-detail", requestId),

  getScanStats: (): Promise<ScanStats | null> =>
    ipcRenderer.invoke("get-scan-stats"),

  readFileContent: (
    filePath: string,
  ): Promise<{ content: string; error?: string }> =>
    ipcRenderer.invoke("read-file-content", filePath),

  // Session-based real-time CT Scan API
  getCurrentSessionId: (): Promise<string> =>
    ipcRenderer.invoke("get-current-session-id"),

  getSessionScans: (sessionId: string): Promise<PromptScan[]> =>
    ipcRenderer.invoke("get-session-scans", sessionId),

  onNewPromptScan: (
    callback: (data: { scan: PromptScan; usage: UsageLogEntry }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { scan: PromptScan; usage: UsageLogEntry },
    ) => callback(data);
    ipcRenderer.on("new-prompt-scan", handler);
    return () => {
      ipcRenderer.removeListener("new-prompt-scan", handler);
    };
  },

  // Usage Dashboard API
  getProviderUsage: (provider: string): Promise<any> =>
    ipcRenderer.invoke("get-provider-usage", provider),

  getAllProviderStatus: (): Promise<any[]> =>
    ipcRenderer.invoke("get-all-provider-status"),

  refreshProviderUsage: (provider?: string): Promise<void> =>
    ipcRenderer.invoke("refresh-provider-usage", provider),

  onProviderTokenChanged: (callback: (provider: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, provider: string) =>
      callback(provider);
    ipcRenderer.on("provider-token-changed", handler);
    return () => {
      ipcRenderer.removeListener("provider-token-changed", handler);
    };
  },

  onProviderUsageUpdated: (
    callback: (data: { provider: string; snapshot: any }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { provider: string; snapshot: any },
    ) => callback(data);
    ipcRenderer.on("provider-usage-updated", handler);
    return () => {
      ipcRenderer.removeListener("provider-usage-updated", handler);
    };
  },

  // Evidence Scoring API
  getEvidenceReport: (
    requestId: string,
  ): Promise<import('./evidence/types').EvidenceReport | null> =>
    ipcRenderer.invoke('get-evidence-report', requestId),

  getEvidenceConfig: (): Promise<import('./evidence/types').EvidenceEngineConfig> =>
    ipcRenderer.invoke('get-evidence-config'),

  updateEvidenceConfig: (
    config: Partial<import('./evidence/types').EvidenceEngineConfig>,
  ): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('update-evidence-config', config),

  rescoreEvidence: (
    requestId: string,
  ): Promise<import('./evidence/types').EvidenceReport | null> =>
    ipcRenderer.invoke('rescore-evidence', requestId),

  onEvidenceScored: (
    callback: (data: { requestId: string; report: import('./evidence/types').EvidenceReport }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { requestId: string; report: import('./evidence/types').EvidenceReport },
    ) => callback(data);
    ipcRenderer.on('evidence-scored', handler);
    return () => {
      ipcRenderer.removeListener('evidence-scored', handler);
    };
  },

  onNavigateTo: (callback: (view: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, view: string) =>
      callback(view);
    ipcRenderer.on("navigate-to", handler);
    return () => {
      ipcRenderer.removeListener("navigate-to", handler);
    };
  },
};

contextBridge.exposeInMainWorld("api", api);

export type ApiType = typeof api;
