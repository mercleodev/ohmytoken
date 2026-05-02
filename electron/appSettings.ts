import type { AppSettings } from "./types";

type AppSettingsOverride = Partial<Omit<AppSettings, "colors">> & {
  colors?: Partial<AppSettings["colors"]>;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
  colors: {
    low: "#4caf50",
    medium: "#ff9800",
    high: "#f44336",
  },
  toggleInterval: 2000,
  refreshInterval: 5,
  shortcut: "CommandOrControl+Shift+T",
  proxyPort: 8780,
};

const positiveNumberOrDefault = (
  value: number | undefined,
  fallback: number,
): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;

export function mergeAppSettings(
  settings: AppSettingsOverride | null | undefined,
): AppSettings {
  const override = settings ?? {};

  return {
    ...DEFAULT_APP_SETTINGS,
    ...override,
    colors: {
      ...DEFAULT_APP_SETTINGS.colors,
      ...(override.colors ?? {}),
    },
    toggleInterval: positiveNumberOrDefault(
      override.toggleInterval,
      DEFAULT_APP_SETTINGS.toggleInterval,
    ),
    refreshInterval: positiveNumberOrDefault(
      override.refreshInterval,
      DEFAULT_APP_SETTINGS.refreshInterval,
    ),
    shortcut: override.shortcut || DEFAULT_APP_SETTINGS.shortcut,
    proxyPort: positiveNumberOrDefault(
      override.proxyPort,
      DEFAULT_APP_SETTINGS.proxyPort,
    ),
  };
}
