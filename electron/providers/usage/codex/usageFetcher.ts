import { readCodexAuth } from '../credentialReader';
import { ProviderUsageSnapshot, UsageWindow } from '../types';

const USAGE_ENDPOINT = 'https://chatgpt.com/backend-api/wham/usage';

const formatResetTime = (resetsAt: string): string => {
  const diff = new Date(resetsAt).getTime() - Date.now();
  if (diff <= 0) return 'Resetting...';

  const totalMin = Math.floor(diff / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;

  if (days > 0) return `Resets in ${days}d ${hours}h`;
  if (hours > 0) return `Resets in ${hours}h ${mins}m`;
  return `Resets in ${mins}m`;
};

export const fetchCodexUsage = async (): Promise<ProviderUsageSnapshot | null> => {
  const auth = readCodexAuth();
  if (!auth) return null;

  // Check expiration
  if (auth.expires_at && auth.expires_at * 1000 < Date.now()) {
    console.warn('[Codex] Token expired');
    return null;
  }

  try {
    const res = await fetch(USAGE_ENDPOINT, {
      headers: {
        'Authorization': `Bearer ${auth.access_token}`,
      },
    });

    if (!res.ok) {
      console.error(`[Codex] Usage API returned ${res.status}`);
      return null;
    }

    const data = (await res.json()) as any;
    const windows: UsageWindow[] = [];

    // Primary (Session, 5h)
    if (data.primary) {
      windows.push({
        label: 'Session',
        usedPercent: Math.round(data.primary.usedPercent ?? data.primary.used_percent ?? 0),
        leftPercent: Math.round(100 - (data.primary.usedPercent ?? data.primary.used_percent ?? 0)),
        resetsAt: data.primary.resetsAt ?? data.primary.resets_at ?? null,
        resetDescription: data.primary.resetsAt
          ? formatResetTime(data.primary.resetsAt)
          : data.primary.resets_at
            ? formatResetTime(data.primary.resets_at)
            : '',
      });
    }

    // Secondary (Weekly)
    if (data.secondary) {
      windows.push({
        label: 'Weekly',
        usedPercent: Math.round(data.secondary.usedPercent ?? data.secondary.used_percent ?? 0),
        leftPercent: Math.round(100 - (data.secondary.usedPercent ?? data.secondary.used_percent ?? 0)),
        resetsAt: data.secondary.resetsAt ?? data.secondary.resets_at ?? null,
        resetDescription: data.secondary.resetsAt
          ? formatResetTime(data.secondary.resetsAt)
          : data.secondary.resets_at
            ? formatResetTime(data.secondary.resets_at)
            : '',
      });
    }

    // Extract plan
    const plan = data.identity?.loginMethod ?? data.plan ?? null;

    return {
      provider: 'codex',
      displayName: 'Codex',
      windows,
      identity: {
        email: data.identity?.accountEmail ?? null,
        plan: plan ? plan.charAt(0).toUpperCase() + plan.slice(1) : null,
      },
      cost: null, // TODO(#125): parse JSONL logs for cost tracking
      updatedAt: new Date().toISOString(),
      source: 'oauth',
    };
  } catch (err) {
    console.error('[Codex] Usage fetch error:', err);
    return null;
  }
};
