import { describe, it, expect } from "vitest";

describe("ElectronApi type contract", () => {
  it("window.api exists and has required methods", () => {
    const api = window.api;
    expect(api).toBeDefined();

    // Core config methods
    expect(typeof api.getConfig).toBe("function");
    expect(typeof api.saveConfig).toBe("function");
    expect(typeof api.addProvider).toBe("function");
    expect(typeof api.removeProvider).toBe("function");
    expect(typeof api.saveSettings).toBe("function");

    // Scan methods
    expect(typeof api.scanTokens).toBe("function");
    expect(typeof api.getPromptHistory).toBe("function");
    expect(typeof api.analyzePrompt).toBe("function");
    expect(typeof api.getContextLogs).toBe("function");

    // Proxy methods
    expect(typeof api.startProxy).toBe("function");
    expect(typeof api.stopProxy).toBe("function");
    expect(typeof api.getProxyStatus).toBe("function");

    // CT Scan methods
    expect(typeof api.getPromptScans).toBe("function");
    expect(typeof api.getPromptScanDetail).toBe("function");
    expect(typeof api.getScanStats).toBe("function");
    expect(typeof api.getCurrentSessionId).toBe("function");
    expect(typeof api.getSessionScans).toBe("function");

    // Usage Dashboard methods
    expect(typeof api.getProviderUsage).toBe("function");
    expect(typeof api.getAllProviderStatus).toBe("function");
    expect(typeof api.refreshProviderUsage).toBe("function");

    // Event listeners
    expect(typeof api.onNewPromptScan).toBe("function");
    expect(typeof api.onProviderTokenChanged).toBe("function");
    expect(typeof api.onProviderUsageUpdated).toBe("function");
    expect(typeof api.onNewHistoryEntry).toBe("function");
    expect(typeof api.onNavigateTo).toBe("function");
  });

  it("scanTokens returns expected shape", async () => {
    const result = await window.api.scanTokens();
    expect(result).toHaveProperty("breakdown");
    expect(result.breakdown).toHaveProperty("claudeMd");
    expect(result.breakdown).toHaveProperty("total");
    expect(result).toHaveProperty("insights");
    expect(result).toHaveProperty("claudeMdSections");
  });

  it("getPromptHistory returns array", async () => {
    const result = await window.api.getPromptHistory();
    expect(Array.isArray(result)).toBe(true);
  });

  it("analyzePrompt returns null or result", async () => {
    const result = await window.api.analyzePrompt("test-id");
    // Mock returns null, but should not throw
    expect(result === null || typeof result === "object").toBe(true);
  });

  it("event listeners return cleanup functions", () => {
    const cleanup1 = window.api.onNewPromptScan(() => {});
    expect(typeof cleanup1).toBe("function");

    const cleanup2 = window.api.onProviderTokenChanged(() => {});
    expect(typeof cleanup2).toBe("function");

    const cleanup3 = window.api.onProviderUsageUpdated(() => {});
    expect(typeof cleanup3).toBe("function");

    const cleanup4 = window.api.onNewHistoryEntry(() => {});
    expect(typeof cleanup4).toBe("function");

    // Clean up
    cleanup1();
    cleanup2();
    cleanup3();
    cleanup4();
  });
});
