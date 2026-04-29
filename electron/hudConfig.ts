// Terminal HUD plugin runtime configuration (design §13.3).
// Kept pure — no electron imports — so it can be loaded from vitest and,
// later, from packages/oht-cli without pulling in the Electron runtime.

export interface HudConfig {
  enabled: boolean;
  globalShortcut: string;
  tui: {
    autoLaunch: boolean;
    layout: "three-line" | "compact";
    refreshHz: number;
  };
  eventBus: {
    port: number;
    token: string | null;
  };
  thresholds: {
    costAlertUsd: number;
    cacheDropPct: number;
    compactEtaTurns: number;
    longSessionMinutes: number;
    hugeFileTokens: number;
  };
  statusLine: {
    enabled: boolean;
    format: "one-line" | "three-line";
  };
}

export const DEFAULT_HUD_CONFIG: HudConfig = Object.freeze({
  enabled: true,
  globalShortcut: "CommandOrControl+Shift+O",
  tui: Object.freeze({
    autoLaunch: false,
    layout: "three-line" as const,
    refreshHz: 10,
  }),
  eventBus: Object.freeze({
    port: 8781,
    token: null,
  }),
  thresholds: Object.freeze({
    costAlertUsd: 5.0,
    cacheDropPct: 30,
    compactEtaTurns: 2,
    longSessionMinutes: 120,
    hugeFileTokens: 50_000,
  }),
  statusLine: Object.freeze({
    enabled: false,
    format: "one-line" as const,
  }),
}) as HudConfig;

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export function mergeHudConfig(
  override: DeepPartial<HudConfig> | null | undefined,
): HudConfig {
  const base = cloneDefaults();
  if (!override) {
    return base;
  }
  return {
    enabled: pickBoolean(override.enabled, base.enabled),
    globalShortcut: pickString(override.globalShortcut, base.globalShortcut),
    tui: {
      autoLaunch: pickBoolean(override.tui?.autoLaunch, base.tui.autoLaunch),
      layout: pickLayout(override.tui?.layout, base.tui.layout),
      refreshHz: pickNumber(override.tui?.refreshHz, base.tui.refreshHz),
    },
    eventBus: {
      port: pickNumber(override.eventBus?.port, base.eventBus.port),
      token: pickTokenOrNull(override.eventBus?.token, base.eventBus.token),
    },
    thresholds: {
      costAlertUsd: pickNumber(
        override.thresholds?.costAlertUsd,
        base.thresholds.costAlertUsd,
      ),
      cacheDropPct: pickNumber(
        override.thresholds?.cacheDropPct,
        base.thresholds.cacheDropPct,
      ),
      compactEtaTurns: pickNumber(
        override.thresholds?.compactEtaTurns,
        base.thresholds.compactEtaTurns,
      ),
      longSessionMinutes: pickNumber(
        override.thresholds?.longSessionMinutes,
        base.thresholds.longSessionMinutes,
      ),
      hugeFileTokens: pickNumber(
        override.thresholds?.hugeFileTokens,
        base.thresholds.hugeFileTokens,
      ),
    },
    statusLine: {
      enabled: pickBoolean(
        override.statusLine?.enabled,
        base.statusLine.enabled,
      ),
      format: pickStatusLineFormat(
        override.statusLine?.format,
        base.statusLine.format,
      ),
    },
  };
}

function cloneDefaults(): HudConfig {
  return {
    enabled: DEFAULT_HUD_CONFIG.enabled,
    globalShortcut: DEFAULT_HUD_CONFIG.globalShortcut,
    tui: { ...DEFAULT_HUD_CONFIG.tui },
    eventBus: { ...DEFAULT_HUD_CONFIG.eventBus },
    thresholds: { ...DEFAULT_HUD_CONFIG.thresholds },
    statusLine: { ...DEFAULT_HUD_CONFIG.statusLine },
  };
}

function pickBoolean(
  value: unknown,
  fallback: boolean,
): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function pickString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function pickNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function pickTokenOrNull(
  value: unknown,
  fallback: string | null,
): string | null {
  if (value === null) return null;
  if (typeof value === "string" && value.length > 0) return value;
  return fallback;
}

function pickLayout(
  value: unknown,
  fallback: HudConfig["tui"]["layout"],
): HudConfig["tui"]["layout"] {
  return value === "compact" || value === "three-line" ? value : fallback;
}

function pickStatusLineFormat(
  value: unknown,
  fallback: HudConfig["statusLine"]["format"],
): HudConfig["statusLine"]["format"] {
  return value === "one-line" || value === "three-line" ? value : fallback;
}
