import { vi } from "vitest";
import "@testing-library/jest-dom";

const noop = () => {};
const noopAsync = () => Promise.resolve();
const noopAsyncNull = () => Promise.resolve(null);
const noopUnsubscribe = () => noop;

const mockApi = {
  saveConfig: vi.fn().mockResolvedValue({ success: true }),
  getConfig: vi.fn().mockResolvedValue({}),
  addProvider: vi.fn().mockResolvedValue({ success: true }),
  removeProvider: vi.fn().mockResolvedValue({ success: true }),
  refreshUsage: vi.fn().mockResolvedValue({ success: true }),
  getUsageData: vi.fn().mockResolvedValue({ settings: {} }),
  saveSettings: vi.fn().mockResolvedValue({ success: true }),
  scanTokens: vi.fn().mockResolvedValue({
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
  getPromptHistory: vi.fn().mockResolvedValue([]),
  analyzePrompt: vi.fn().mockResolvedValue(null),
  getContextLogs: vi.fn().mockResolvedValue({
    autoInjected: [],
    readFiles: [],
    globSearches: [],
    grepSearches: [],
  }),
  startProxy: vi.fn().mockResolvedValue({ success: true }),
  stopProxy: vi.fn().mockResolvedValue({ success: true }),
  getProxyStatus: vi.fn().mockResolvedValue({
    running: false,
    port: null,
    upstream: null,
    requests_total: 0,
    errors_total: 0,
  }),
  getRecentHistory: vi.fn().mockResolvedValue([]),
  getDailyStats: vi.fn(noopAsyncNull),
  getHistoryPromptDetail: vi.fn(noopAsyncNull),
  onNewHistoryEntry: vi.fn(noopUnsubscribe),
  getPromptScans: vi.fn().mockResolvedValue([]),
  getPromptScanDetail: vi.fn(noopAsyncNull),
  getScanStats: vi.fn(noopAsyncNull),
  readFileContent: vi.fn().mockResolvedValue({ content: "" }),
  getCurrentSessionId: vi.fn().mockResolvedValue("test-session"),
  getSessionScans: vi.fn().mockResolvedValue([]),
  onNewPromptScan: vi.fn(noopUnsubscribe),
  getProviderUsage: vi.fn(noopAsyncNull),
  getAllProviderStatus: vi.fn().mockResolvedValue([]),
  refreshProviderUsage: vi.fn(noopAsync),
  onProviderTokenChanged: vi.fn(noopUnsubscribe),
  onProviderUsageUpdated: vi.fn(noopUnsubscribe),
  onNavigateTo: vi.fn(noopUnsubscribe),
};

Object.defineProperty(window, "api", {
  value: mockApi,
  writable: true,
  configurable: true,
});
