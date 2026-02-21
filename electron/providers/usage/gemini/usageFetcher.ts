import { readGeminiOAuth, readGeminiSettings } from '../credentialReader';
import { ProviderUsageSnapshot, UsageWindow } from '../types';

const QUOTA_ENDPOINT = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota';
const CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';

type QuotaBucket = {
  modelId: string;
  remainingFraction: number;
  resetTime: string;
  quotaType?: string;
};

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

const extractEmailFromIdToken = (idToken: string): string | null => {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64').toString());
    return payload.email ?? null;
  } catch {
    return null;
  }
};

export const fetchGeminiUsage = async (): Promise<ProviderUsageSnapshot | null> => {
  const settings = readGeminiSettings();
  // Only support oauth-personal or no settings (default)
  if (settings?.authType && settings.authType !== 'oauth-personal') {
    console.warn(`[Gemini] Unsupported auth type: ${settings.authType}`);
    return null;
  }

  const creds = readGeminiOAuth();
  if (!creds) return null;

  // Check expiration - attempt even if expired (return null if server rejects)
  const isExpired = creds.expiry_date && creds.expiry_date < Date.now();
  if (isExpired) {
    console.warn('[Gemini] Token may be expired, attempting anyway');
  }

  try {
    // Fetch quota
    const quotaRes = await fetch(QUOTA_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${creds.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!quotaRes.ok) {
      console.error(`[Gemini] Quota API returned ${quotaRes.status}`);
      return null;
    }

    const quotaData = (await quotaRes.json()) as any;
    const quotas: QuotaBucket[] = (quotaData.quotas ?? []) as QuotaBucket[];

    if (quotas.length === 0) {
      console.warn('[Gemini] No quota buckets returned');
      return null;
    }

    // Classify models: Pro vs Flash
    const proModels = quotas.filter((q) => q.modelId?.includes('pro'));
    const flashModels = quotas.filter((q) => q.modelId?.includes('flash'));
    const otherModels = quotas.filter((q) => !q.modelId?.includes('pro') && !q.modelId?.includes('flash'));

    const windows: UsageWindow[] = [];

    // Pro models (lowest remainingFraction)
    const lowestPro = proModels.length > 0
      ? proModels.reduce((min, q) => q.remainingFraction < min.remainingFraction ? q : min)
      : null;

    if (lowestPro) {
      const usedPercent = Math.round((1 - lowestPro.remainingFraction) * 100);
      windows.push({
        label: 'Pro',
        usedPercent,
        leftPercent: 100 - usedPercent,
        resetsAt: lowestPro.resetTime,
        resetDescription: formatResetTime(lowestPro.resetTime),
      });
    }

    // Flash models
    const lowestFlash = flashModels.length > 0
      ? flashModels.reduce((min, q) => q.remainingFraction < min.remainingFraction ? q : min)
      : null;

    if (lowestFlash) {
      const usedPercent = Math.round((1 - lowestFlash.remainingFraction) * 100);
      windows.push({
        label: 'Flash',
        usedPercent,
        leftPercent: 100 - usedPercent,
        resetsAt: lowestFlash.resetTime,
        resetDescription: formatResetTime(lowestFlash.resetTime),
      });
    }

    // If neither Pro nor Flash, use lowest from all
    if (windows.length === 0 && otherModels.length > 0) {
      const lowest = otherModels.reduce((min, q) => q.remainingFraction < min.remainingFraction ? q : min);
      const usedPercent = Math.round((1 - lowest.remainingFraction) * 100);
      windows.push({
        label: 'Quota',
        usedPercent,
        leftPercent: 100 - usedPercent,
        resetsAt: lowest.resetTime,
        resetDescription: formatResetTime(lowest.resetTime),
      });
    }

    // Extract email (from id_token JWT)
    const email = creds.id_token ? extractEmailFromIdToken(creds.id_token) : null;

    // Attempt tier detection
    let plan: string | null = null;
    try {
      const codeAssistRes = await fetch(CODE_ASSIST_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${creds.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ metadata: { ideType: 'GEMINI_CLI', pluginType: 'GEMINI' } }),
      });
      if (codeAssistRes.ok) {
        const caData = (await codeAssistRes.json()) as any;
        const tierMap: Record<string, string> = {
          'standard-tier': 'Paid',
          'free-tier': 'Free',
          'legacy-tier': 'Legacy',
        };
        plan = tierMap[caData.tier] ?? caData.tier ?? null;
      }
    } catch {
      // Ignore tier detection failure
    }

    return {
      provider: 'gemini',
      displayName: 'Gemini',
      windows,
      identity: { email, plan },
      cost: null,
      updatedAt: new Date().toISOString(),
      source: 'oauth',
    };
  } catch (err) {
    console.error('[Gemini] Usage fetch error:', err);
    return null;
  }
};
