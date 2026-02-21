import { readClaudeCredentials } from "../credentialReader";
import { ProviderUsageSnapshot, UsageWindow } from "../types";
import { fetchClaudeUsageViaCLI } from "./cliUsageProbe";
import { fetchCreditBalance } from "./creditBalanceFetcher";

const USAGE_ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const ANTHROPIC_BETA = "oauth-2025-04-20";

type ClaudeUsageResponse = {
  five_hour?: {
    used_percent: number;
    resets_at: string;
    window_minutes?: number;
  };
  seven_day?: {
    used_percent: number;
    resets_at: string;
    window_minutes?: number;
  };
  seven_day_sonnet?: {
    used_percent: number;
    resets_at: string;
  };
  seven_day_opus?: {
    used_percent: number;
    resets_at: string;
  };
  extra_usage?: {
    monthly_spend_usd: number;
    monthly_limit_usd: number;
  };
  rate_limit_tier?: string;
};

const formatResetTime = (resetsAt: string): string => {
  const diff = new Date(resetsAt).getTime() - Date.now();
  if (diff <= 0) return "Resetting...";

  const totalMin = Math.floor(diff / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;

  if (days > 0) return `Resets in ${days}d ${hours}h`;
  if (hours > 0) return `Resets in ${hours}h ${mins}m`;
  return `Resets in ${mins}m`;
};

export const fetchClaudeUsage =
  async (): Promise<ProviderUsageSnapshot | null> => {
    const creds = readClaudeCredentials();
    if (!creds) {
      console.log("[Claude] No credentials found");
      return null;
    }

    const isApiKey =
      creds.accessToken.startsWith("sk-ant-api") ||
      (creds.accessToken.startsWith("sk-ant-") &&
        !creds.accessToken.startsWith("sk-ant-oat"));

    // API key only means no OAuth → try CLI PTY → on failure, show prepaid notice + credit balance
    if (isApiKey) {
      console.log("[Claude] API key detected, trying CLI PTY probe first");
      const cliResult = await fetchClaudeUsageViaCLI();
      if (cliResult && cliResult.windows.length > 0) return cliResult;

      // CLI also failed → assume prepaid account, check credit balance
      console.log(
        "[Claude] CLI PTY returned no usage data, checking credit balance for prepaid account",
      );
      const creditBalance = await fetchCreditBalance();
      return {
        provider: "claude",
        displayName: "Claude",
        windows: [],
        identity: { email: null, plan: "API (Prepaid)" },
        cost: null,
        notice:
          "Individual Prepaid accounts do not have usage windows (5h/7d).\nSwitch to a subscription plan (Pro/Max/Enterprise) to view usage data.",
        creditBalance: creditBalance ?? undefined,
        updatedAt: new Date().toISOString(),
        source: "api-key",
      };
    }

    // OAuth token: fall back to CLI PTY if missing scope
    if (!creds.scopes?.includes("user:profile")) {
      console.warn(
        "[Claude] Token missing user:profile scope, falling back to CLI PTY",
      );
      return fetchClaudeUsageViaCLI();
    }

    // OAuth token: fall back to CLI PTY if expired
    if (creds.expiresAt && new Date(creds.expiresAt).getTime() < Date.now()) {
      console.warn("[Claude] Token expired, falling back to CLI PTY");
      return fetchClaudeUsageViaCLI();
    }

    try {
      const res = await fetch(USAGE_ENDPOINT, {
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          "anthropic-beta": ANTHROPIC_BETA,
        },
      });

      if (!res.ok) {
        console.error(
          `[Claude] Usage API returned ${res.status}, falling back to CLI PTY`,
        );
        return fetchClaudeUsageViaCLI();
      }

      const data = (await res.json()) as any;
      const windows: UsageWindow[] = [];

      // Utility: extract percent value (handles various field names)
      const getPct = (obj: any): number => {
        if (!obj) return 0;
        return (
          obj.utilization ??
          obj.used_percent ??
          obj.usedPercent ??
          obj.percent_used ??
          0
        );
      };
      const getResetAt = (obj: any): string => {
        if (!obj) return "";
        return (
          obj.resets_at ?? obj.resetsAt ?? obj.reset_at ?? obj.resetAt ?? ""
        );
      };

      // If reset time has already passed, the API returned stale data → correct to 0%
      const buildWindow = (label: string, obj: any): void => {
        if (!obj) return;
        const resetAt = getResetAt(obj);
        const isPastReset = resetAt && new Date(resetAt).getTime() < Date.now();
        const used = isPastReset ? 0 : getPct(obj);
        windows.push({
          label,
          usedPercent: Math.round(used),
          leftPercent: Math.round(100 - used),
          resetsAt: resetAt,
          resetDescription: resetAt ? formatResetTime(resetAt) : "",
        });
      };

      // Session (5h) - handles various key names
      buildWindow(
        "Session",
        data.five_hour ?? data.fiveHour ?? data.session ?? data.current_session,
      );

      // Weekly (7d) window
      buildWindow("Weekly", data.seven_day ?? data.sevenDay ?? data.weekly);

      // Sonnet (per-model weekly)
      buildWindow(
        "Sonnet",
        data.seven_day_sonnet ?? data.sevenDaySonnet ?? data.sonnet,
      );

      // Opus (per-model weekly)
      buildWindow(
        "Opus",
        data.seven_day_opus ?? data.sevenDayOpus ?? data.opus,
      );

      // Plan mapping
      const planMap: Record<string, string> = {
        pro: "Pro",
        max_5: "Max",
        max_20: "Max",
        max: "Max",
        team: "Team",
        enterprise: "Enterprise",
        free: "Free",
      };
      const plan = data.rate_limit_tier
        ? (planMap[data.rate_limit_tier] ?? data.rate_limit_tier)
        : null;

      // OAuth 200 OK but windows empty → try CLI PTY → prepaid notice
      if (windows.length === 0) {
        console.warn(
          "[Claude] OAuth API returned empty usage data, trying CLI PTY",
        );
        const cliResult = await fetchClaudeUsageViaCLI();
        if (cliResult && cliResult.windows.length > 0) return cliResult;

        // CLI also failed → prepaid account notice + credit balance
        console.log(
          "[Claude] No usage windows from any source, checking credit balance",
        );
        const creditBalance = await fetchCreditBalance();
        return {
          provider: "claude",
          displayName: "Claude",
          windows: [],
          identity: { email: null, plan: plan ?? "API (Prepaid)" },
          cost: null,
          notice:
            "Individual Prepaid accounts do not have usage windows (5h/7d).\nSwitch to a subscription plan (Pro/Max/Enterprise) to view usage data.",
          creditBalance: creditBalance ?? undefined,
          updatedAt: new Date().toISOString(),
          source: "oauth-empty",
        };
      }

      return {
        provider: "claude",
        displayName: "Claude",
        windows,
        identity: {
          email: null, // OAuth usage API doesn't include email
          plan,
        },
        cost: null, // TODO: add cost via JSONL log parsing
        updatedAt: new Date().toISOString(),
        source: "oauth",
      };
    } catch (err) {
      console.error(
        "[Claude] Usage fetch error, falling back to CLI PTY:",
        err,
      );
      const cliResult = await fetchClaudeUsageViaCLI();
      if (cliResult && cliResult.windows.length > 0) return cliResult;

      // All sources failed → try credit balance as last resort
      const creditBalance = await fetchCreditBalance();
      if (creditBalance) {
        return {
          provider: "claude",
          displayName: "Claude",
          windows: [],
          identity: { email: null, plan: "API (Prepaid)" },
          cost: null,
          notice:
            "Unable to retrieve usage data.\nShowing API credit balance only.",
          creditBalance,
          updatedAt: new Date().toISOString(),
          source: "credit-only",
        };
      }
      return cliResult;
    }
  };
