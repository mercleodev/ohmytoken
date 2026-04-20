import type { AccountInsightsState, UsageProviderType } from './types';

// Phase 3 — runtime error cache for account-insight connect attempts.
// buildProviderConnectionStatus consumes this so transient failures
// (Keychain denied, upstream API unavailable) surface to the renderer
// as discrete states instead of collapsing into `not_connected`.
// See plans/runtime-first-account-optional-onboarding-implementation.md §7.5.

export type RuntimeInsightsError = Extract<
  AccountInsightsState,
  'access_denied' | 'unavailable'
>;

const errors: Partial<Record<UsageProviderType, RuntimeInsightsError>> = {};

export const setAccountInsightsRuntimeError = (
  provider: UsageProviderType,
  error: RuntimeInsightsError,
): void => {
  errors[provider] = error;
};

export const clearAccountInsightsRuntimeError = (
  provider: UsageProviderType,
): void => {
  delete errors[provider];
};

export const getAccountInsightsRuntimeError = (
  provider: UsageProviderType,
): RuntimeInsightsError | null => errors[provider] ?? null;
