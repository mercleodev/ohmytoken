import { describe, expect, it } from "vitest";

import { DEFAULT_APP_SETTINGS, mergeAppSettings } from "../appSettings";

describe("mergeAppSettings", () => {
  it("returns full defaults when settings are missing", () => {
    expect(mergeAppSettings(undefined)).toStrictEqual(DEFAULT_APP_SETTINGS);
    expect(mergeAppSettings(null)).toStrictEqual(DEFAULT_APP_SETTINGS);
  });

  it("preserves default timing values when persisted settings are partial", () => {
    const merged = mergeAppSettings({
      accountInsights: { claude: true },
    });

    expect(merged.toggleInterval).toBe(DEFAULT_APP_SETTINGS.toggleInterval);
    expect(merged.refreshInterval).toBe(DEFAULT_APP_SETTINGS.refreshInterval);
    expect(merged.accountInsights).toStrictEqual({ claude: true });
  });

  it("deep-merges colors so one override does not drop sibling colors", () => {
    const merged = mergeAppSettings({
      colors: { high: "#000000" },
    });

    expect(merged.colors).toStrictEqual({
      ...DEFAULT_APP_SETTINGS.colors,
      high: "#000000",
    });
  });

  it("falls back to safe positive timing and port defaults", () => {
    const merged = mergeAppSettings({
      toggleInterval: 0,
      refreshInterval: Number.NaN,
      proxyPort: -1,
      shortcut: "",
    });

    expect(merged.toggleInterval).toBe(DEFAULT_APP_SETTINGS.toggleInterval);
    expect(merged.refreshInterval).toBe(DEFAULT_APP_SETTINGS.refreshInterval);
    expect(merged.proxyPort).toBe(DEFAULT_APP_SETTINGS.proxyPort);
    expect(merged.shortcut).toBe(DEFAULT_APP_SETTINGS.shortcut);
  });
});
