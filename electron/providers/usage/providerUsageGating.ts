import {
  isAccountInsightsEnabled,
  type AccountInsightsOptInMap,
} from './accountInsightsSettings';
import type { ProviderUsageSnapshot, UsageProviderType } from './types';

type SettingsWithInsights =
  | { accountInsights?: AccountInsightsOptInMap }
  | null
  | undefined;

type Deps = {
  getCached: () => ProviderUsageSnapshot | null;
  refresh: () => Promise<ProviderUsageSnapshot | null>;
};

export const resolveProviderUsageRequest = async (
  settings: SettingsWithInsights,
  provider: UsageProviderType,
  deps: Deps,
): Promise<ProviderUsageSnapshot | null> => {
  if (!isAccountInsightsEnabled(settings, provider)) return null;
  const cached = deps.getCached();
  if (cached) return cached;
  return await deps.refresh();
};
