import { useEffect, useState, useCallback } from 'react';
import type {
  ProviderConnectionStatus,
  UsageProviderType,
  TrackingState,
  AccountInsightsState,
} from '../../types';

const PROVIDER_ICONS: Record<UsageProviderType, string> = {
  claude: '✺',
  codex: '◎',
  gemini: '◆',
};

const TRACKING_LABEL: Record<TrackingState, string> = {
  not_enabled: 'Not Enabled',
  waiting_for_activity: 'Waiting For Activity',
  active: 'Active',
};

const ACCOUNT_LABEL: Record<AccountInsightsState, string> = {
  not_connected: 'Not Connected',
  connected: 'Connected',
  expired: 'Expired',
  access_denied: 'Access Denied',
  unavailable: 'Unavailable',
};

const PRIMARY_CTA_BY_STATE: Record<AccountInsightsState, string> = {
  not_connected: 'Connect Account',
  connected: 'Disconnect',
  expired: 'Reconnect',
  access_denied: 'Retry',
  unavailable: 'Retry',
};

export const ConnectionsSection = () => {
  const [statuses, setStatuses] = useState<ProviderConnectionStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyProvider, setBusyProvider] = useState<UsageProviderType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await window.api.getAllProviderConnectionStatus();
      setStatuses(next);
      setError(null);
    } catch (err) {
      console.error('[ConnectionsSection] Failed to load statuses:', err);
      setError('Could not read provider connection status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handlePrimary = useCallback(
    async (status: ProviderConnectionStatus) => {
      setBusyProvider(status.provider);
      setError(null);
      try {
        const state = status.accountInsights;
        if (state === 'connected') {
          await window.api.accountInsightsDisconnect(status.provider);
        } else if (state === 'expired' || state === 'access_denied' || state === 'unavailable') {
          await window.api.accountInsightsReconnect(status.provider);
        } else {
          await window.api.accountInsightsConnect(status.provider);
        }
        await load();
      } catch (err) {
        console.error('[ConnectionsSection] Action failed:', err);
        setError('Action failed. Check logs and try again.');
      } finally {
        setBusyProvider(null);
      }
    },
    [load],
  );

  if (loading) {
    return (
      <div className="settings-group">
        <h3>Connections</h3>
        <p className="hint">Loading provider status…</p>
      </div>
    );
  }

  return (
    <div className="settings-group">
      <h3>Connections</h3>
      <p className="hint">
        Tracking stays active even if account connection fails. Account insights add plan details, quota windows, and reset timing.
      </p>
      {error && <p className="hint" style={{ color: '#d93025' }}>{error}</p>}
      <div className="connections-list">
        {statuses.map((status) => (
          <article key={status.provider} className="connection-row">
            <div className="connection-row-head">
              <span className="connection-row-icon" aria-hidden>{PROVIDER_ICONS[status.provider]}</span>
              <div>
                <div className="connection-row-name">{status.displayName}</div>
                <div className="connection-row-meta">
                  <span>Tracking: {TRACKING_LABEL[status.tracking]}</span>
                  <span>·</span>
                  <span>Account Insights: {ACCOUNT_LABEL[status.accountInsights]}</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              className="connection-row-primary"
              disabled={busyProvider === status.provider}
              onClick={() => handlePrimary(status)}
            >
              {busyProvider === status.provider ? 'Working…' : PRIMARY_CTA_BY_STATE[status.accountInsights]}
            </button>
          </article>
        ))}
      </div>
    </div>
  );
};
