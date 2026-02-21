// Usage Dashboard common types (for Electron Main process)

export type UsageProviderType = 'claude' | 'codex' | 'gemini';

export type UsageWindow = {
  label: string;
  usedPercent: number;
  leftPercent: number;
  resetsAt: string | null;
  resetDescription: string;
  paceDescription?: string;
};

export type CreditBalance = {
  balanceUSD: number;
  grantedUSD?: number;
  usedUSD?: number;
  expiresAt?: string;
};

export type ProviderUsageSnapshot = {
  provider: UsageProviderType;
  displayName: string;
  windows: UsageWindow[];
  identity: {
    email: string | null;
    plan: string | null;
  } | null;
  cost: {
    todayCostUSD: number;
    todayTokens: number;
    last30DaysCostUSD: number;
    last30DaysTokens: number;
  } | null;
  notice?: string;
  creditBalance?: CreditBalance;
  updatedAt: string;
  source: string;
};

export type ProviderTokenStatus = {
  provider: UsageProviderType;
  displayName: string;
  installed: boolean;
  hasToken: boolean;
  tokenExpired: boolean;
  setupCommands: {
    install: string;
    login: string;
    refresh: string;
  };
};

// Credential types for each provider

export type ClaudeCredentials = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  scopes?: string[];
};

export type CodexAuth = {
  access_token: string;
  refresh_token?: string;
  expires_at?: number; // unix timestamp (seconds)
  token_type?: string;
};

export type GeminiOAuthCreds = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expiry_date: number; // unix timestamp (milliseconds)
  token_type?: string;
};

export type GeminiSettings = {
  authType: string;
};
