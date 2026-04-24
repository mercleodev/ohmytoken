import { describe, it, expect } from "vitest";

import {
  DEFAULT_HUD_CONFIG,
  mergeHudConfig,
  type HudConfig,
} from "../hudConfig";

describe("DEFAULT_HUD_CONFIG", () => {
  it("matches the design-document defaults (idea/terminal-hud-plugin.md §13.3)", () => {
    expect(DEFAULT_HUD_CONFIG).toStrictEqual<HudConfig>({
      enabled: true,
      globalShortcut: "CommandOrControl+Shift+O",
      tui: {
        autoLaunch: false,
        layout: "three-line",
        refreshHz: 10,
      },
      eventBus: {
        port: 8781,
        token: null,
      },
      thresholds: {
        costAlertUsd: 5.0,
        cacheDropPct: 30,
        compactEtaTurns: 2,
        longSessionMinutes: 120,
        hugeFileTokens: 50_000,
      },
      statusLine: {
        enabled: false,
        format: "one-line",
      },
    });
  });

  it("is frozen so callers can never mutate the canonical defaults by accident", () => {
    expect(Object.isFrozen(DEFAULT_HUD_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_HUD_CONFIG.tui)).toBe(true);
    expect(Object.isFrozen(DEFAULT_HUD_CONFIG.eventBus)).toBe(true);
    expect(Object.isFrozen(DEFAULT_HUD_CONFIG.thresholds)).toBe(true);
    expect(Object.isFrozen(DEFAULT_HUD_CONFIG.statusLine)).toBe(true);
  });
});

describe("mergeHudConfig", () => {
  it("returns a fresh HudConfig equal to DEFAULT_HUD_CONFIG when no override is supplied", () => {
    const merged = mergeHudConfig(undefined);
    expect(merged).toStrictEqual(DEFAULT_HUD_CONFIG);
    expect(merged).not.toBe(DEFAULT_HUD_CONFIG); // should be a fresh copy
  });

  it("returns defaults when the override is null or an empty object", () => {
    expect(mergeHudConfig(null)).toStrictEqual(DEFAULT_HUD_CONFIG);
    expect(mergeHudConfig({})).toStrictEqual(DEFAULT_HUD_CONFIG);
  });

  it("deep-merges nested groups so a single nested key override does not drop siblings", () => {
    const merged = mergeHudConfig({
      eventBus: { token: "secret" },
      tui: { refreshHz: 30 },
    });

    expect(merged.eventBus.port).toBe(8781); // sibling preserved
    expect(merged.eventBus.token).toBe("secret"); // override applied
    expect(merged.tui.autoLaunch).toBe(false); // sibling preserved
    expect(merged.tui.layout).toBe("three-line"); // sibling preserved
    expect(merged.tui.refreshHz).toBe(30); // override applied
  });

  it("lets callers disable the bus entirely for rollback", () => {
    const merged = mergeHudConfig({ enabled: false });
    expect(merged.enabled).toBe(false);
    // Nested defaults still populated so downstream code can read them
    // even when the feature is toggled off.
    expect(merged.eventBus.port).toBe(8781);
    expect(merged.tui.layout).toBe("three-line");
  });

  it("is idempotent — merging an already-full HudConfig returns the same shape", () => {
    const once = mergeHudConfig({ tui: { layout: "compact" } });
    const twice = mergeHudConfig(once);
    expect(twice).toStrictEqual(once);
  });

  it("ignores unknown keys rather than propagating them into the returned config", () => {
    // Configs may be read from disk after a downgrade, which can reintroduce
    // stale keys. The merge layer has to discard them without crashing.
    const raw: unknown = {
      unknownField: "nope",
      tui: {
        stray: 123,
        layout: "compact",
      },
    };
    const merged = mergeHudConfig(raw as Parameters<typeof mergeHudConfig>[0]);
    expect(merged.tui.layout).toBe("compact");
    expect((merged as unknown as Record<string, unknown>).unknownField).toBeUndefined();
    expect((merged.tui as unknown as Record<string, unknown>).stray).toBeUndefined();
  });

  it("survives a round-trip through JSON so persisted configs can be reloaded unchanged", () => {
    const first = mergeHudConfig({
      globalShortcut: "CommandOrControl+Option+O",
      thresholds: { costAlertUsd: 10.0 },
    });
    const json = JSON.parse(JSON.stringify(first)) as Parameters<
      typeof mergeHudConfig
    >[0];
    const second = mergeHudConfig(json);
    expect(second).toStrictEqual(first);
    // HudConfig reference type is unused when the test file only imports types
    // for the default-shape assertion above — keep the import alive for
    // documentation even when the structural assertions move to inference.
    void (null as HudConfig | null);
  });
});
