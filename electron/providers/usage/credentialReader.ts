import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import {
  UsageProviderType,
  ProviderTokenStatus,
  ProviderConnectionStatus,
  TrackingState,
  AccountInsightsState,
  ClaudeCredentials,
  CodexAuth,
  GeminiOAuthCreds,
  GeminiSettings,
} from './types';

// === Claude ===

const CLAUDE_CRED_FILE_PATH = path.join(homedir(), '.claude', '.credentials.json');

export const readClaudeCredentials = (): ClaudeCredentials | null => {
  // Priority 1: Keychain OAuth (macOS) - "Claude Code-credentials"
  try {
    const raw = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    const parsed = JSON.parse(raw);

    // Keychain format: {"claudeAiOauth":{"accessToken":"...", ...}}
    const oauthData = parsed.claudeAiOauth ?? parsed;
    if (oauthData.accessToken) {
      return {
        accessToken: oauthData.accessToken,
        refreshToken: oauthData.refreshToken,
        expiresAt: oauthData.expiresAt ?? '',
        scopes: oauthData.scopes,
      };
    }
  } catch {
    // Keychain credentials access failed → next fallback
  }

  // Priority 2: Keychain API Key (macOS) - "Claude Code"
  try {
    const apiKey = execSync(
      'security find-generic-password -s "Claude Code" -w',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (apiKey.startsWith('sk-ant-')) {
      return {
        accessToken: apiKey,
        expiresAt: '',
      };
    }
  } catch {
    // Keychain API key access failed → file fallback
  }

  // Priority 3: File fallback (~/.claude/.credentials.json)
  try {
    const raw = fs.readFileSync(CLAUDE_CRED_FILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);

    // Handle claudeAiOauth wrapper format (same as Keychain)
    const oauthData = parsed.claudeAiOauth ?? parsed;
    if (oauthData.accessToken) {
      return {
        accessToken: oauthData.accessToken,
        refreshToken: oauthData.refreshToken,
        expiresAt: oauthData.expiresAt ?? '',
        scopes: oauthData.scopes,
      };
    }
    return null;
  } catch {
    return null;
  }
};

const isClaudeTokenExpired = (creds: ClaudeCredentials): boolean => {
  if (!creds.expiresAt) return false;
  return new Date(creds.expiresAt).getTime() < Date.now();
};

const hasClaudeProfileScope = (creds: ClaudeCredentials): boolean => {
  // If scopes field is missing, assume true (handle failure on API call)
  if (!creds.scopes || creds.scopes.length === 0) return true;
  return creds.scopes.includes('user:profile');
};

// API Key reader (for credit balance lookup, API Key takes priority over OAuth)
export const readClaudeApiKey = (): string | null => {
  // Priority 1: Keychain API Key (macOS) - "Claude Code"
  try {
    const apiKey = execSync(
      'security find-generic-password -s "Claude Code" -w',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (apiKey.startsWith('sk-ant-api')) {
      return apiKey;
    }
  } catch {
    // Keychain access failed
  }

  // Priority 2: File fallback
  try {
    const raw = fs.readFileSync(CLAUDE_CRED_FILE_PATH, 'utf-8');
    const creds = JSON.parse(raw);
    if (creds.accessToken?.startsWith('sk-ant-api')) {
      return creds.accessToken;
    }
  } catch {
    // File read failed
  }

  return null;
};

// === Codex ===

const getCodexAuthPath = (): string => {
  const codexHome = process.env.CODEX_HOME;
  if (codexHome) return path.join(codexHome, 'auth.json');
  return path.join(homedir(), '.codex', 'auth.json');
};

export const readCodexAuth = (): CodexAuth | null => {
  try {
    const raw = fs.readFileSync(getCodexAuthPath(), "utf-8");
    const auth = JSON.parse(raw) as Record<string, unknown>;
    const tokenBundle =
      auth.tokens && typeof auth.tokens === "object"
        ? (auth.tokens as Record<string, unknown>)
        : {};

    // Support both legacy format (access_token at top-level)
    // and newer format (tokens.access_token).
    const accessToken =
      (typeof auth.access_token === "string" ? auth.access_token : null) ??
      (typeof tokenBundle.access_token === "string"
        ? tokenBundle.access_token
        : null);
    if (!accessToken) return null;

    const refreshToken =
      (typeof auth.refresh_token === "string" ? auth.refresh_token : null) ??
      (typeof tokenBundle.refresh_token === "string"
        ? tokenBundle.refresh_token
        : null) ??
      undefined;
    const tokenType =
      (typeof auth.token_type === "string" ? auth.token_type : null) ??
      (typeof tokenBundle.token_type === "string" ? tokenBundle.token_type : null) ??
      undefined;

    const expiresAtCandidates = [
      auth.expires_at,
      tokenBundle.expires_at,
      // Prefer access_token exp (long-lived, used for API calls)
      // over id_token exp (short-lived, ~1h, identity only).
      extractJwtExp(
        (typeof auth.access_token === "string" ? auth.access_token : null) ??
          (typeof tokenBundle.access_token === "string"
            ? tokenBundle.access_token
            : null),
      ),
      extractJwtExp(
        (typeof auth.id_token === "string" ? auth.id_token : null) ??
          (typeof tokenBundle.id_token === "string"
            ? tokenBundle.id_token
            : null),
      ),
    ]
      .map(normalizeUnixSeconds)
      .filter((v): v is number => v !== null);

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAtCandidates[0],
      token_type: tokenType,
    };
  } catch {
    return null;
  }
};

const normalizeUnixSeconds = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  // Convert ms epoch to seconds if needed.
  return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
};

const extractJwtExp = (jwt: string | null): number | null => {
  if (!jwt) return null;
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8"),
    ) as Record<string, unknown>;
    return normalizeUnixSeconds(payload.exp);
  } catch {
    return null;
  }
};

const isCodexTokenExpired = (auth: CodexAuth): boolean => {
  if (!auth.expires_at) return false;
  return auth.expires_at * 1000 < Date.now();
};

// === Gemini ===

const GEMINI_DIR = path.join(homedir(), '.gemini');
const GEMINI_SETTINGS_PATH = path.join(GEMINI_DIR, 'settings.json');
const GEMINI_CRED_PATH = path.join(GEMINI_DIR, 'oauth_creds.json');

export const readGeminiSettings = (): GeminiSettings | null => {
  try {
    return JSON.parse(fs.readFileSync(GEMINI_SETTINGS_PATH, 'utf-8'));
  } catch {
    return null;
  }
};

export const readGeminiOAuth = (): GeminiOAuthCreds | null => {
  try {
    const raw = fs.readFileSync(GEMINI_CRED_PATH, 'utf-8');
    const creds = JSON.parse(raw);
    if (!creds.access_token) return null;
    return creds as GeminiOAuthCreds;
  } catch {
    return null;
  }
};

const isGeminiTokenExpired = (creds: GeminiOAuthCreds): boolean => {
  if (!creds.expiry_date) return false;
  return creds.expiry_date < Date.now();
};

// === CLI installation check ===

// Common global binary locations on macOS / Linux
const EXTRA_BIN_DIRS = [
  '/usr/local/bin',
  '/opt/homebrew/bin',
  path.join(homedir(), '.nvm/current/bin'),
  path.join(homedir(), '.local/bin'),
  path.join(homedir(), '.npm-global/bin'),
];

const getExpandedPath = (): string => {
  const base = process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin';
  const dirs = new Set(base.split(':'));
  for (const d of EXTRA_BIN_DIRS) {
    dirs.add(d);
  }
  // Also try to resolve the real nvm bin directory
  try {
    const shell = process.env.SHELL || '/bin/zsh';
    const shellPath = execSync(`${shell} -lc 'echo $PATH'`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim();
    for (const d of shellPath.split(':')) {
      dirs.add(d);
    }
  } catch {
    // Shell PATH resolution failed — use static dirs only
  }
  return [...dirs].join(':');
};

let cachedPath: string | null = null;

const isCLIInstalled = (command: string): boolean => {
  try {
    if (cachedPath === null) {
      cachedPath = getExpandedPath();
    }
    execSync(`which ${command}`, {
      encoding: 'utf-8',
      stdio: 'pipe',
      env: { ...process.env, PATH: cachedPath },
    });
    return true;
  } catch {
    return false;
  }
};

// === Token file paths (used by watcher) ===

export const TOKEN_FILE_PATHS: Record<UsageProviderType, string> = {
  claude: CLAUDE_CRED_FILE_PATH,  // For watching; reads from Keychain even if file doesn't exist
  codex: getCodexAuthPath(),
  gemini: GEMINI_CRED_PATH,
};

// === Unified: provider token status lookup ===

const SETUP_COMMANDS: Record<UsageProviderType, { install: string; login: string; refresh: string }> = {
  claude: {
    install: 'npm install -g @anthropic-ai/claude-code',
    login: 'claude',
    refresh: 'claude /login',
  },
  codex: {
    install: 'npm install -g @openai/codex',
    login: 'codex',
    refresh: 'codex',
  },
  gemini: {
    install: 'npm install -g @google/gemini-cli',
    login: 'gemini',
    refresh: 'gemini',
  },
};

const CLI_COMMANDS: Record<UsageProviderType, string> = {
  claude: 'claude',
  codex: 'codex',
  gemini: 'gemini',
};

const DISPLAY_NAMES: Record<UsageProviderType, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
};

type TokenStatusOptions = {
  forceRefresh?: boolean;
};

const TOKEN_STATUS_CACHE_TTL_MS = 5_000;
const tokenStatusCache = new Map<UsageProviderType, {
  status: ProviderTokenStatus;
  cachedAt: number;
}>();

export const getProviderTokenStatus = (
  provider: UsageProviderType,
  options: TokenStatusOptions = {},
): ProviderTokenStatus => {
  if (!options.forceRefresh) {
    const cached = tokenStatusCache.get(provider);
    if (cached && Date.now() - cached.cachedAt < TOKEN_STATUS_CACHE_TTL_MS) {
      return cached.status;
    }
  }

  const installed = isCLIInstalled(CLI_COMMANDS[provider]);

  let hasToken = false;
  let tokenExpired = false;

  if (provider === 'claude') {
    const creds = readClaudeCredentials();
    hasToken = creds !== null && hasClaudeProfileScope(creds);
    tokenExpired = creds !== null && isClaudeTokenExpired(creds);
  } else if (provider === 'codex') {
    const auth = readCodexAuth();
    hasToken = auth !== null;
    tokenExpired = auth !== null && isCodexTokenExpired(auth);
  } else if (provider === 'gemini') {
    const settings = readGeminiSettings();
    const creds = readGeminiOAuth();
    const isOAuthType = settings?.authType === 'oauth-personal' || !settings?.authType;
    hasToken = creds !== null && isOAuthType;
    tokenExpired = creds !== null && isGeminiTokenExpired(creds);
  }

  const status: ProviderTokenStatus = {
    provider,
    displayName: DISPLAY_NAMES[provider],
    installed,
    hasToken,
    tokenExpired,
    setupCommands: SETUP_COMMANDS[provider],
  };

  tokenStatusCache.set(provider, {
    status,
    cachedAt: Date.now(),
  });

  return status;
};

export const getAllProviderStatuses = (): ProviderTokenStatus[] => {
  const providers: UsageProviderType[] = ['claude', 'codex', 'gemini'];
  return providers.map((provider) => getProviderTokenStatus(provider));
};

// === Phase 2 — split tracking vs account-insights connection status ===

const SESSION_ROOTS: Record<UsageProviderType, string> = {
  claude: path.join(homedir(), '.claude', 'projects'),
  codex: path.join(homedir(), '.codex', 'sessions'),
  gemini: path.join(homedir(), '.gemini', 'tmp'),
};

const hasSessionRoot = (provider: UsageProviderType): boolean => {
  try {
    return fs.existsSync(SESSION_ROOTS[provider]);
  } catch {
    return false;
  }
};

type TrackingSignals = {
  // DB row count for this provider (aggregated by db reader).
  promptCount: number;
  // Most recent tracked prompt timestamp for this provider, if any.
  lastTrackedAt: string | null;
  // Whether a watcher has fired for this provider in the current process lifetime.
  watcherFired: boolean;
};

const deriveTrackingState = (
  provider: UsageProviderType,
  signals: TrackingSignals,
): TrackingState => {
  const rootExists = hasSessionRoot(provider);
  if (!rootExists && signals.promptCount === 0) return 'not_enabled';
  if (signals.watcherFired || signals.promptCount > 0) return 'active';
  return 'waiting_for_activity';
};

// Phase 3 — when the user has not opted in, `accountInsights` stays at
// `not_connected` regardless of local credential state. Runtime errors from
// a connect attempt (keychain denied / upstream unavailable) override the
// token-derived state so the renderer can distinguish failure modes.
// Plan §7.5 failure taxonomy.
export type BuildConnectionStatusContext = {
  optedIn?: boolean;
  runtimeError?: 'access_denied' | 'unavailable' | null;
};

const deriveAccountInsightsState = (
  status: ProviderTokenStatus,
  ctx: BuildConnectionStatusContext,
): AccountInsightsState => {
  if (ctx.optedIn !== true) return 'not_connected';
  if (ctx.runtimeError) return ctx.runtimeError;
  if (status.tokenExpired) return 'expired';
  if (status.hasToken) return 'connected';
  return 'not_connected';
};

type ConnectionStatusSignalsProvider = (
  provider: UsageProviderType,
) => TrackingSignals;

type ConnectionStatusContextProvider = (
  provider: UsageProviderType,
) => BuildConnectionStatusContext;

export const buildProviderConnectionStatus = (
  provider: UsageProviderType,
  getSignals: ConnectionStatusSignalsProvider,
  ctx: BuildConnectionStatusContext = {},
): ProviderConnectionStatus => {
  const tokenStatus = getProviderTokenStatus(provider);
  const signals = getSignals(provider);
  return {
    provider,
    displayName: tokenStatus.displayName,
    tracking: deriveTrackingState(provider, signals),
    accountInsights: deriveAccountInsightsState(tokenStatus, ctx),
    installed: tokenStatus.installed,
    hasLocalCredential: tokenStatus.hasToken,
    tokenExpired: tokenStatus.tokenExpired,
    lastTrackedAt: signals.lastTrackedAt,
    setupCommands: tokenStatus.setupCommands,
  };
};

export const buildAllProviderConnectionStatuses = (
  getSignals: ConnectionStatusSignalsProvider,
  getContext: ConnectionStatusContextProvider = () => ({}),
): ProviderConnectionStatus[] => {
  const providers: UsageProviderType[] = ['claude', 'codex', 'gemini'];
  return providers.map((p) =>
    buildProviderConnectionStatus(p, getSignals, getContext(p)),
  );
};
