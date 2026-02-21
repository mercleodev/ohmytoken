import "@testing-library/jest-dom/vitest";
import type { ElectronApi } from "../types/electron.d";

// Mock window.api for all tests
const mockApi: ElectronApi = {
  getConfig: async () => ({
    providers: [],
    settings: {
      colors: { low: "#4caf50", medium: "#ff9800", high: "#f44336" },
      toggleInterval: 2000,
      refreshInterval: 5,
      shortcut: "CommandOrControl+Shift+T",
      proxyPort: 8780,
    },
  }),
  saveConfig: async () => ({ success: true }),
  addProvider: async () => ({ success: true }),
  removeProvider: async () => ({ success: true }),
  refreshUsage: async () => ({ success: true }),
  getUsageData: async () => ({
    usage: 0,
    resetTime: null,
    sevenDay: null,
    providerName: "Claude",
    settings: {
      colors: { low: "#4caf50", medium: "#ff9800", high: "#f44336" },
      toggleInterval: 2000,
      refreshInterval: 5,
      shortcut: "CommandOrControl+Shift+T",
      proxyPort: 8780,
    },
  }),
  saveSettings: async () => ({ success: true }),
  scanTokens: async () => ({
    breakdown: {
      claudeMd: { global: 0, project: 0, total: 0 },
      userInput: 0,
      cacheCreation: 0,
      cacheRead: 0,
      output: 0,
      total: 0,
    },
    insights: [],
    claudeMdSections: [],
  }),
  getPromptHistory: async () => [],
  analyzePrompt: async () => null,
  getContextLogs: async () => ({
    autoInjected: [],
    readFiles: [],
    globSearches: [],
    grepSearches: [],
  }),
  startProxy: async () => ({ success: true }),
  stopProxy: async () => ({ success: true }),
  getProxyStatus: async () => ({
    running: false,
    port: null,
    upstream: null,
    requests_total: 0,
    errors_total: 0,
  }),
  getRecentHistory: async () => [],
  getDailyStats: async () => null,
  getHistoryPromptDetail: async () => null,
  onNewHistoryEntry: () => () => {},
  getPromptScans: async () => [],
  getPromptScanDetail: async () => null,
  getScanStats: async () => null,
  readFileContent: async () => ({ content: "" }),
  getCurrentSessionId: async () => "test-session",
  getSessionScans: async () => [],
  onNewPromptScan: () => () => {},
  getProviderUsage: async () => null,
  getAllProviderStatus: async () => [],
  refreshProviderUsage: async () => {},
  onProviderTokenChanged: () => () => {},
  onProviderUsageUpdated: () => () => {},
  onNavigateTo: () => () => {},
};

Object.defineProperty(window, "api", {
  value: mockApi,
  writable: true,
  configurable: true,
});
