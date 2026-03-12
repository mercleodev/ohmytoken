/* eslint-disable @typescript-eslint/no-explicit-any */
import { contextBridge, ipcRenderer } from "electron";
import {
  ProviderConfig,
  CurrentUsageData,
  AppSettings,
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

  // History (passive session monitoring)
  getRecentHistory: (limit?: number): Promise<any[]> =>
    ipcRenderer.invoke("get-recent-history", limit),

  getDailyStats: (provider?: string): Promise<any> => ipcRenderer.invoke("get-daily-stats", provider),

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
    provider?: string;
  }): Promise<PromptScan[]> => ipcRenderer.invoke("get-prompt-scans", options),

  getPromptScanDetail: (
    requestId: string,
  ): Promise<{ scan: PromptScan; usage: UsageLogEntry | null } | null> =>
    ipcRenderer.invoke("get-prompt-scan-detail", requestId),

  getScanStats: (provider?: string): Promise<ScanStats | null> =>
    ipcRenderer.invoke("get-scan-stats", provider),

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

  // Token Output Productivity API
  getTokenComposition: (
    period: 'today' | '7d' | '30d',
    provider?: string,
  ): Promise<import('./db/reader').TokenCompositionResult> =>
    ipcRenderer.invoke('get-token-composition', period, provider),

  getOutputProductivity: (provider?: string): Promise<import('./db/reader').OutputProductivityResult> =>
    ipcRenderer.invoke('get-output-productivity', provider),

  getSessionTurnMetrics: (
    sessionId: string,
  ): Promise<import('./db/reader').TurnMetric[]> =>
    ipcRenderer.invoke('get-session-turn-metrics', sessionId),

  getCostSummary: (provider?: string): Promise<{
    todayCostUSD: number; todayTokens: number;
    last30DaysCostUSD: number; last30DaysTokens: number;
  }> => ipcRenderer.invoke('get-cost-summary', provider),

  // MCP Insights API
  getMcpInsights: (
    period: 'today' | '7d' | '30d',
    provider?: string,
  ) => ipcRenderer.invoke('get-mcp-insights', period, provider),

  getSessionMcpAnalysis: (
    sessionId: string,
  ) => ipcRenderer.invoke('get-session-mcp-analysis', sessionId),

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

  // Backfill API
  backfillStart: (): Promise<import('./backfill/types').BackfillResult> =>
    ipcRenderer.invoke('backfill:start'),

  backfillCancel: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('backfill:cancel'),

  backfillCount: (): Promise<number> =>
    ipcRenderer.invoke('backfill:count'),

  backfillStatus: (): Promise<{ completed: boolean; lastScanTimestamp: number | null }> =>
    ipcRenderer.invoke('backfill:status'),

  onBackfillProgress: (
    callback: (progress: import('./backfill/types').BackfillProgress) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: import('./backfill/types').BackfillProgress,
    ) => callback(progress);
    ipcRenderer.on('backfill:progress', handler);
    return () => {
      ipcRenderer.removeListener('backfill:progress', handler);
    };
  },

  onBackfillComplete: (
    callback: (result: import('./backfill/types').BackfillResult) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      result: import('./backfill/types').BackfillResult,
    ) => callback(result);
    ipcRenderer.on('backfill:complete', handler);
    return () => {
      ipcRenderer.removeListener('backfill:complete', handler);
    };
  },
};

contextBridge.exposeInMainWorld("api", api);

export type ApiType = typeof api;
