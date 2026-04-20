import type { UsageProviderType } from './types';

// Phase 3 — Runtime-first + Account-optional onboarding.
// Account insights access is explicitly user-initiated. The persisted
// AppSettings.accountInsights map holds the per-provider opt-in flag.
// See plans/runtime-first-account-optional-onboarding-implementation.md §7.

export type AccountInsightsOptInMap = Partial<Record<UsageProviderType, boolean>>;

type SettingsWithInsights = {
  accountInsights?: AccountInsightsOptInMap;
} | null | undefined;

export const ALL_INSIGHTS_PROVIDERS: UsageProviderType[] = ['claude', 'codex', 'gemini'];

export const isAccountInsightsEnabled = (
  settings: SettingsWithInsights,
  provider: UsageProviderType,
): boolean => settings?.accountInsights?.[provider] === true;

export const getOptedInProviders = (
  settings: SettingsWithInsights,
): UsageProviderType[] =>
  ALL_INSIGHTS_PROVIDERS.filter((p) => isAccountInsightsEnabled(settings, p));

export const setAccountInsightsEnabled = (
  settings: SettingsWithInsights,
  provider: UsageProviderType,
  enabled: boolean,
): AccountInsightsOptInMap => {
  const current = settings?.accountInsights ?? {};
  return { ...current, [provider]: enabled };
};
