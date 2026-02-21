import "@testing-library/jest-dom";

// Mock window.api (Electron IPC bridge)
const mockApi = {
  saveConfig: vi.fn().mockResolvedValue({ success: true }),
  getConfig: vi.fn().mockResolvedValue({}),
  addProvider: vi.fn().mockResolvedValue({ success: true }),
  removeProvider: vi.fn().mockResolvedValue({ success: true }),
  refreshUsage: vi.fn().mockResolvedValue({ success: true }),
  getUsageData: vi.fn().mockResolvedValue({ settings: {} }),
  saveSettings: vi.fn().mockResolvedValue({ success: true }),
  scanTokens: vi.fn().mockResolvedValue({}),
  getPromptHistory: vi.fn().mockResolvedValue([]),
  analyzePrompt: vi.fn().mockResolvedValue({}),
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
  getDailyStats: vi.fn().mockResolvedValue(null),
  getHistoryPromptDetail: vi.fn().mockResolvedValue(null),
  onNewHistoryEntry: vi.fn().mockReturnValue(() => {}),
  getPromptScans: vi.fn().mockResolvedValue([]),
  getPromptScanDetail: vi.fn().mockResolvedValue(null),
  getScanStats: vi.fn().mockResolvedValue(null),
  readFileContent: vi.fn().mockResolvedValue({ content: "" }),
  getCurrentSessionId: vi.fn().mockResolvedValue("test-session-id"),
  getSessionScans: vi.fn().mockResolvedValue([]),
  onNewPromptScan: vi.fn().mockReturnValue(() => {}),
  getProviderUsage: vi.fn().mockResolvedValue(null),
  getAllProviderStatus: vi.fn().mockResolvedValue([]),
  refreshProviderUsage: vi.fn().mockResolvedValue(undefined),
  onProviderTokenChanged: vi.fn().mockReturnValue(() => {}),
  onProviderUsageUpdated: vi.fn().mockReturnValue(() => {}),
  onNavigateTo: vi.fn().mockReturnValue(() => {}),
};

Object.defineProperty(window, "api", {
  value: mockApi,
  writable: true,
  configurable: true,
});
